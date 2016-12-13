'use strict';

var common = __dirname + '/../../../common/';
var restify = require(common + 'node_modules/restify');
var fs = require('fs');
var und = require('underscore');
var util    = require('util');
var ProtoBuf = require('protobufjs');
var Readable = require('stream').Readable;
var slackWebApiClient = require('@slack/client').WebClient;

ProtoBuf.convertFieldsToCamelCase = true;

function ExecutionCompleteHandler(subscriber, logger, config) {

    var SCHEMA_NAMESPACE = 'i2OWater.Anapos.Governance.EnterpriseEvents.Admin.ExecutionInConsoleComplete';
    var PROTOBUF_PROTO_FILENAME = 'proto/EnterpriseEvents.Admin.proto';
    var HTTP_SERVICE_UNAVAILABLE = 503;
    var protoFile = common + PROTOBUF_PROTO_FILENAME;
    var that = this;

    that._logger = logger;
    that._subscriber = subscriber;
    that._config = config;

    var slackToken =  process.env.SLACK_BOT_TOKEN || '';
    var slackWebClient = new slackWebApiClient(slackToken);

    var _onProtoFileRead = function (err, builder) {
        if (err) {
            throw err;
        }

        var eventSchema = builder.build(SCHEMA_NAMESPACE);

        var _handler = function (schema) {
            return function _onEEReceived(event) {

                var buildMessage = function(executionCompleteEvent) {
                    var items = [
                        executionCompleteEvent.errorOutput,
                        executionCompleteEvent.warningOutput,
                        executionCompleteEvent.standardOutput
                    ];
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

                that._logger.log('info', 'Received event of type: ' + SCHEMA_NAMESPACE);
                try {
                    var executionComplete = schema.decode(event.body);
                    var slackMessage = buildMessage(executionComplete);
                    var inputFiles = executionComplete.fileInputNames.length > 0
                                        ? executionComplete.fileInputNames.join("\r\n")
                                        : "[None]";
                    var outputFiles = executionComplete.fileOutput.length > 0
                                        ? und.pluck(executionComplete.fileOutput, 'key').join("\r\n")
                                        : "[None]";
                    var attachments = [
                        {
                            "fallback": slackMessage.Text,
                            "title": slackMessage.Title,
                            "text": slackMessage.Text,
                            "color": slackMessage.Color,
                            "fields": [
                                {"title": "Command", "value": executionComplete.command, "short": true},
                                {"title": "Status", "value": slackMessage.StatusLabel, "short": true},
                                {"title": "Input Files", "value": inputFiles, "short": false},
                                {"title": "Ouput Files", "value": outputFiles, "short": false},
                                {"title": "SupportId", "value": executionComplete.rootEvent.instruction.supportId, "short": false}
                            ],
                            "footer": util.format("Executed in Admin Console on behalf of %s", executionComplete.externalUsername),
                            "ts": Math.round(executionComplete.rootEvent.instruction.created.toNumber()/1000)
                        }
                    ];

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
                    }

                    var slackChannel = executionComplete.externalUserId;

                    slackWebClient.chat.postMessage(slackChannel, null, responseOptions, function (err, res) {
                        logSlackResponse(err, res, "message");

                        executionComplete.fileOutput.forEach(function(outputFile) {
                            var fileOpts = {
                                content: outputFile.value,
                                filename: outputFile.key,
                                channels: slackChannel,
                                initial_comment: util.format("Output from command: %s", executionComplete.command)
                            };

                            var title = util.format("Output attachment: %s", outputFile.key);
                            slackWebClient.files.upload(title, fileOpts, function (err, res) {
                                logSlackResponse(err, res, "attachment");
                            });
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