'use strict';

var util = require('util');
var https = require('https');
var url = require('url');
var und = require('underscore');
var AdmZip = require('adm-zip');

function SlackEventMapper(botSettings) {
    var that = this;

    that._botSettings = botSettings;

    var _toSerializedMessage = function(slackEvent, supportId, doSerialize, onSerialized) {

        var serializeAndContinue = function(commandText, fileInput) {
            var serialized = doSerialize(commandText, fileInput);
            onSerialized(serialized, slackEvent, commandText, supportId);
        };

        var isFileShareEvent = function(evt) {
            var handledFileEvents = ["file_share", "file_comment"];

            return evt.subtype
                && und.contains(handledFileEvents, evt.subtype)
                && evt.file
                && evt.file.url_private;
        };

        var handlePlainTextContent = function(commandText, fileName, r) {
            var fileContent = '';
            r.on('data', function(d) {
                fileContent += d;
            });
            r.on('end', function() {
                var fileInput = fileContent ? [{key: fileName, value: fileContent}] : [];
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
                    var filename = zipEntries[i].entryName;

                    var content = zip.readFile(zipEntries[i]);
                    if(content) {
                        fileInput.push({key: filename, value: content});
                    }
                }
                serializeAndContinue(commandText, fileInput);
            });
        };

        var handleUnknownContent = function(commandText, fileName, r) {
            serializeAndContinue(commandText, []);
        };

        var attachmentHandlerMap = [
            {key:"text/plain; charset=utf-8", handler: handlePlainTextContent},
            {key:"application/zip", handler: handleZipContent}
        ];

        var getDefaultCommand = function(file) {
            if(that._botSettings.defaultFileAttachmentCommand){
                return util.format(that._botSettings.defaultFileAttachmentCommand, file);
            }
            return "-";
        };

        var processFileShareEvent = function(evt) {
            var getCommand = function(fileName) {
                var userEnteredCommand = evt.comment || evt.file.initial_comment;
                var command = userEnteredCommand ? userEnteredCommand.comment : getDefaultCommand(fileName);
                return command;
            };

            var fileName = evt.file.title;
            var commandText = getCommand(fileName);

            var buildGetOptions = function(token, fileUrl) {
                var parsedFileUrl = url.parse(fileUrl);
                var getOptions = {
                    host: parsedFileUrl.host,
                    path: parsedFileUrl.path,
                    headers: {Authorization: util.format("Bearer %s", slackToken)}
                };

                return getOptions;
            };

            var slackToken =  that._botSettings.slackToken;
            var fileGetOptions = buildGetOptions(slackToken, evt.file.url_private);

            var getFileResponseHandler = function(response) {
                if(response.headers["location"]) {
                    var redirectedGetOptions = buildGetOptions(slackToken, response.headers["location"]);
                    https.get(redirectedGetOptions, getFileResponseHandler);
                    return;
                }

                if(!response.headers["content-type"]) {
                    handleUnknownContent(response);
                    return;
                }

                var forContentType = und.filter(attachmentHandlerMap, function(h){
                    return h.key === response.headers["content-type"];
                })[0];
                var handler = forContentType ? forContentType.handler : handleUnknownContent;

                handler(commandText, fileName, response);
            };

            https.get(fileGetOptions, getFileResponseHandler);
        };

        var processTextMessageEvent = function(evt) {
            if(evt.text) {
                serializeAndContinue(evt.text, []);
            }
            else if(evt.message && evt.message.text) {
                serializeAndContinue(evt.message.text, []);
            }
        };

        if(isFileShareEvent(slackEvent)) {
            processFileShareEvent(slackEvent);
            return;
        }

        processTextMessageEvent(slackEvent);
    };

    that.toSerializedMessage = _toSerializedMessage;

    return that;
}

module.exports = SlackEventMapper;