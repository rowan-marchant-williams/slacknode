'use strict';

var common = __dirname + '/../../../common/';
var restify = require(common + 'node_modules/restify');
var fs = require('fs');
var und = require('underscore');
var util    = require('util');
var ProtoBuf = require('protobufjs');
var slackWebApiClient = require('@slack/client').WebClient;
var AdmZip = require('adm-zip');
var FormData = require('form-data');

ProtoBuf.convertFieldsToCamelCase = true;

function ExecutionCompleteHandler(subscriber, logger, config, botSettings) {

    var eventSubscriptionSettings = botSettings.serviceEventSubscription;
    var schemaNamespace = eventSubscriptionSettings.schemaNamespace;
    var protobufFilename = eventSubscriptionSettings.protobufFilename;
    var protoFile = common + protobufFilename;
    var that = this;

    that._logger = logger;
    that._subscriber = subscriber;
    that._config = config;
    that._botSettings = botSettings;

    var slackToken =  that._botSettings.slackToken;
    var slackWebClient = new slackWebApiClient(slackToken);

    var _onProtoFileRead = function (err, builder) {
        if (err) {
            throw err;
        }
		
		var handlerMsg = util.format('Building handler for schemaNamespace %s', schemaNamespace);
		that._logger.log('info', handlerMsg);

        var eventSchema = builder.build(schemaNamespace);

        var _handler = function (schema) {
            return function _onEEReceived(event) {

                var buildMessage = function(executionCompleteEvent) {
                    var items = [];

                    if(executionCompleteEvent.errorOutput) {
                        items.push(util.format('Error(s):\r\n%s', executionCompleteEvent.errorOutput))
                    }

                    if(executionCompleteEvent.warningOutput) {
                        items.push(util.format('Warning(s):\r\n%s', executionCompleteEvent.warningOutput))
                    }

                    if(executionCompleteEvent.standardOutput) {
                        items.push(util.format('All output:\r\n%s', executionCompleteEvent.standardOutput))
                    }

                    var withContent = und.filter(items, function(item) {return item;});
                    var messageContent = withContent.join("\r\n") + "\r\n-----------------------------------------\r\n";

                    if(executionCompleteEvent.errorOutput) {
                        return {"Title": "Error:", "StatusLabel": "Error", "Color": "danger", "Text": messageContent};
                    }
                    else if(executionCompleteEvent.warningOutput) {
                        return {"Title": "Warning:", "StatusLabel": "Warning", "Color": "warning", "Text": messageContent};
                    }

                    return {"Title": "Console Response:", "StatusLabel": "Success", "Color": "good", "Text": messageContent};
                }

                that._logger.log('info', 'Received event of type: ' + schemaNamespace);
                try {
                    var executionComplete = schema.decode(event.body);
                    var slackMessage = buildMessage(executionComplete);

                    var buildFileNamesFor = function(zipFileName, fileArr) {
                        var fileList = fileArr.length > 0
                            ? und.pluck(fileArr, 'key')
                            : [];

                        var fileLabels = fileList.length > 1
                            ? util.format("%s containing:\r\n - %s", zipFileName, fileList.join("\r\n - "))
                            : (fileList.length == 1) ? fileList[0] : "[None]";

                        return fileLabels;
                    };

                    var zipInputFilename = "commandInput.zip";
                    var zipOutputFilename = "commandOutput.zip";

                    var inputFilesLabel = buildFileNamesFor(zipInputFilename, executionComplete.fileInput);
                    var outputFilesLabel = buildFileNamesFor(zipOutputFilename, executionComplete.fileOutput);

                    var attachments = [{
                            "fallback": slackMessage.Text,
                            "title": slackMessage.Title,
                            "text": slackMessage.Text,
                            "color": slackMessage.Color,
                            "fields": [
                                {"title": "Command", "value": executionComplete.command, "short": false},
                                {"title": "Ouput Files", "value": outputFilesLabel, "short": false},
                                {"title": "SupportId", "value": executionComplete.rootEvent.instruction.supportId, "short": false}
                            ],
                            "footer": util.format("Executed in Admin Console on behalf of %s", executionComplete.externalUsername),
                            "ts": Math.round(executionComplete.rootEvent.instruction.created.toNumber()/1000)
                    }];

                    var responseOptions = {
                        "attachments": attachments
                    };

                    var logSlackResponse = function(err, res, messageType) {
                        if (err) {
                            that._logger.log('Error sending ' + messageType, err);
                        } else {
                            if(res.ok) {
                                that._logger.log("info", messageType + ' sent: ', res);
                            }
                            else {
                                that._logger.log('error', "Error sending " + messageType , res);
                            }
                        }
                    };

                    var channelsToPostTo = [executionComplete.externalUserId];

                    if(that._botSettings.slackAuditChannel && that._botSettings.slackAuditChannel.id) {
                        channelsToPostTo.push(that._botSettings.slackAuditChannel.id);
                    }

                    var getFileAttachment = function(zipFileName, files) {
                        if(files.length === 0) {
                            return null;
                        }
                        else if(files.length === 1) {
                            var singleFile = files[0];
                            return {name: singleFile.key, buffer: singleFile.value.buffer};
                        }

                        var zip = new AdmZip();
                        files.forEach(function(outputFile) {
                            zip.addFile(outputFile.key, outputFile.value.buffer);
                        });
                        return {name: zipFileName, buffer: zip.toBuffer()};
                    };

                    var sendAttachment = function(zipFileName, files, slackChannel) {
                        var attachment = getFileAttachment(zipFileName, files);

                        if(attachment) {

                            //slack file upload accepts a straight post request containing a content param for plain text
                            //attachments, or a multipart/form-data request for binary attachments. The multipart/form-data method
                            //will also work for plain text attachments.
                            //The slack node client does not work with binary attachments using a multipart/form-data post,
                            //therefore, constructing the form-data post without using the slack node client.

                            var form = new FormData();
                            form.append('channels', slackChannel);
                            form.append('initial_comment', util.format("command: %s | user: %s | supportId: %s", executionComplete.command, executionComplete.externalUsername, executionComplete.rootEvent.instruction.supportId));
                            form.append('filename', attachment.name);
                            form.append('file', attachment.buffer, {
                                filename: attachment.name,
                                contentType: (files.length > 1 ? 'application/x-zip-compressed' : 'text/plain')
                            });

                            //when using multipart http post requests to slack, slack will only
                            //accept the request if the token is included as a url param, it will
                            //not accept an Authorization header, therefore include the token as
                            //a url param
                            var uploadPath = util.format('/api/files.upload?token=%s', slackToken);

                            form.submit({
                                    protocol: 'https:',
                                    host: 'slack.com',
                                    path: uploadPath
                                },
                                function(err, res){
                                    var responseContent = '';
                                    res.on('data', function(d) {
                                        responseContent += d;
                                    });
                                    res.on('end', function() {
                                        var parsed = JSON.parse(responseContent);
                                        logSlackResponse(err, parsed, "attachment");
                                    });
                                }
                            );
                        };
                    };

                    channelsToPostTo.forEach(function(slackChannel) {
                        slackWebClient.chat.postMessage(slackChannel, null, responseOptions, function (err, res) {
                            logSlackResponse(err, res, "message");

                            sendAttachment(zipInputFilename, executionComplete.fileInput, slackChannel);
                            sendAttachment(zipOutputFilename, executionComplete.fileOutput, slackChannel);
                        });
                    });

                    return;
                } catch (e) {
                    that._logger.log('error', 'ExecutionInConsoleComplete handler error: ', e.message);
                }
            };
        };

        that._subscriber.on('data', _handler(eventSchema));
    };

    ProtoBuf.loadProtoFile(protoFile, _onProtoFileRead);

    var _destroySubscriber = function () {
        if (that._subscriber) {
            that._subscriber.destroy();
            delete that._subscriber;
        }
    };

    that.destroy = _destroySubscriber;

    return that;
}

module.exports = ExecutionCompleteHandler;