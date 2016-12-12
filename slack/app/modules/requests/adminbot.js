'use strict';

var common = __dirname + '/../../../../common/';
var Request = require(common + 'request');
var AmqpRequester = require(common + 'amqp/requester');
var helpers = require(common + 'utils/helpers');
var uuid = require('node-uuid');
var util = require('util');
var async = require('async');
var fs = require('fs');
var und = require('underscore');
var config  = require('konphyg')(common + 'config');
var slackWebApiClient = require('@slack/client').WebClient;
var https = require('https');
var url = require('url');
var AdmZip = require('adm-zip');

var TEN_SECONDS = 10 * 1000; // Anapos uses Milliseconds

function AdminBotRequest(config, cache) {
    var that = this;
    that._config = config;
    that._myGoodResponse = new Request('i2OWater.Anapos.Governance.Admin.Responses.ExecuteResponse');
    that._goodResponseTypeId = that._myGoodResponse.getMessageTypeId();
    that._myFailureResponse = new Request('i2OWater.Anapos.Governance.FailureResponse');
    that._failureResponseTypeId = that._myFailureResponse.getMessageTypeId();
    that._cache = cache;

    return that;
}

AdminBotRequest.prototype = new Request('i2OWater.Anapos.Governance.Admin.Requests.ExecuteRequest');

AdminBotRequest.prototype.serialize = function (body, req, onSerialized) {
    var that = this;
    that._buildInstruction(body, req);
    that._readSchema();

    that._instruction.ttl = that._config.request.ttl || TEN_SECONDS;

    var slackEvent = req.body.event;

    var runSerialize = function(commandText, fileInput) {
        var adminRequest = {
            rootRequest: {
                instruction: that._instruction
            },
            user: slackEvent.channel,
            command: commandText,
            fileInput: fileInput
        };

        that._config.amqp.qName = that._QueueName;
        var serialized = new that._messageSchema(adminRequest);
        return serialized.toBuffer();
    };

    var serializeAndContinue = function(commandText, fileInput) {
        var serialized = runSerialize(commandText, fileInput);
        onSerialized(serialized);
    }

    var isFileShareEvent = function(evt) {
        var sharedFileSubType = "file_share";
        return slackEvent.subtype && slackEvent.subtype === sharedFileSubType && slackEvent.file && slackEvent.file.url_private;
    }

    var handlePlainTextContent = function(commandText, fileName, r) {
        var fileContent = '';
        r.on('data', function(d) {
            fileContent += d;
        });
        r.on('end', function() {
            var fileInput = fileContent ? [{key: fileName, value: fileContent}] : [];
            var serialized = runSerialize(commandText, fileInput);
            serializeAndContinue(commandText, fileInput);
        });
    };

    var handleZipContent = function(commandText, fileName, r) {
        var data = [], dataLen = 0;

        r.on('data', function(chunk) {
            data.push(chunk);
            dataLen += chunk.length;
        });
        r.on('end', function() {
            var buf = new Buffer(dataLen);

            for (var i = 0, len = data.length, pos = 0; i < len; i++) {
                data[i].copy(buf, pos);
                pos += data[i].length;
            }

            var zip = new AdmZip(buf);
            var zipEntries = zip.getEntries();
            var fileInput = [];

            for (var i = 0; i < zipEntries.length; i++) {
                var name = zipEntries[i].entryName;
                var content = zip.readAsText(zipEntries[i]);
                fileInput.push({key: name, value: content});
            }
            serializeAndContinue(commandText, fileInput);
        });
    };

    var handleUnknownContent = function(commandText, fileName, r) {
        serializeAndContinue(commandText, []);
    }

    var attachmentHandlerMap = [
        {key:"text/plain; charset=utf-8", handler: handlePlainTextContent},
        {key:"application/zip", handler: handleZipContent}
    ];

    var processFileShareEvent = function(evt) {
        var commentToUse = evt.comment || evt.file.initial_comment;
        var commandText = commentToUse ? commentToUse.comment : "No command found with file";
        var fileName = evt.file.name;

        var slackToken =  process.env.SLACK_BOT_TOKEN || '';
        var privateDownloadUrl = url.parse(evt.file.url_private);

        var getOptions = {
            host: privateDownloadUrl.host,
            path: privateDownloadUrl.path,
            headers: {Authorization: "Bearer " + slackToken}
        };

        https.get(getOptions, function(response) {
            if(!response.headers["content-type"]) {
                handleUnknownContent(response);
                return;
            }

            var forContentType = und.filter(attachmentHandlerMap, function(h){
                return h.key === response.headers["content-type"];
            })[0];
            var handler = forContentType ? forContentType.handler : handleUnknownContent;

            handler(commandText, fileName, response);
        });
    };

    var processTextMessageEvent = function(evt) {
        serializeAndContinue(evt.text, []);
    };

    if(isFileShareEvent(slackEvent)) {
        processFileShareEvent(slackEvent);
    }
    else {
        processTextMessageEvent(slackEvent);
    }
};

AdminBotRequest.prototype.execute = function (req, res, cb) {
    var that = this;

    var onSerialized = function(serialized) {
        var sendOptions = {
            exchange: '/',
            headers: {
                _req_resp_type_id: that.getExpectedResponseTypeId()
            },
            messageId: that.getMessageTypeId()
        };

        var requester = new AmqpRequester(that._config);

        requester.on('error', function(err) {
            var HTTP_SERVICE_UNAVAILABLE = 503;

            if (err === 'request timeout') {
                cb(null, HTTP_SERVICE_UNAVAILABLE, { failureReason: 'Request Timeout', supportId: that._instruction.supportId });
            } else {
                cb(err);
            }
        });

        requester.on('data', function (data, msg) {
            var HTTP_SERVER_ERROR = 500;
            var HTTP_FORBIDDEN = 403;
            var HTTP_OK = 200;
            var response;

            if (msg.messageId === that._goodResponseTypeId) {
                response = that._myGoodResponse.parse(data);

                if (cb) {
                    res.send(HTTP_OK);
                    cb(null, HTTP_OK, response);
                    return;
                }
                else {
                    res.send(HTTP_SERVER_ERROR, 'No Callback Provided');
                }
            } else if (msg.messageId === that._failureResponseTypeId) {
                response = that._myFailureResponse.parse(data);
                if (cb) {
                    cb(null, HTTP_FORBIDDEN, response);
                    return;
                }

                res.send(HTTP_SERVER_ERROR, 'No Callback Provided');
            }
        });

        requester.send(sendOptions, serialized);
    };

    that.serialize(req.body, req, onSerialized);
};

module.exports = AdminBotRequest;

