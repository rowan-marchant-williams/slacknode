'use strict';

var slackWebApiClient = require('@slack/client').WebClient;
var util = require('util');

function SlackEventAcknowledger(logger, botSettings) {
    var that = this;
    that._logger = logger;
    that._botSettings = botSettings;

    var slackToken =  that._botSettings.slackToken;
    var slackWebClient = new slackWebApiClient(slackToken);

    var _sendMessageThroughSlack = function(message, channel) {
        var channelsToPostTo = [channel];

        if(that._botSettings.slackAuditChannel && that._botSettings.slackAuditChannel.id) {
            channelsToPostTo.push(that._botSettings.slackAuditChannel.id);
        }

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

        channelsToPostTo.forEach(function(slackChannel) {
            slackWebClient.chat.postMessage(slackChannel, message, function (err, res) {
                logSlackResponse(err, res, "message");
            });
        });
    };

    var _wireUpAmqpRequester = function(requester, responseOptions, supportId, slackEvent) {

        var buildSlackErrorMessage = function(error) {
            return util.format("An error occurred whilst sending the command: %s, SupportId %s", error, supportId);
        };

        requester.on('error', function(err) {
            _sendMessageThroughSlack(buildSlackErrorMessage(err), slackEvent.channel);
            that._logger.log('error', err);
        });

        requester.on('data', function (data, msg) {
            var HTTP_SERVER_ERROR = 500;
            var HTTP_FORBIDDEN = 403;
            var HTTP_OK = 200;
            var response;

            if (msg.messageId === responseOptions.goodResponseTypeId) {
                response = responseOptions.myGoodResponse.parse(data);
                that._logger.log('info', response);
            } else if (msg.messageId === responseOptions.failureResponseTypeId) {
                response = responseOptions.myFailureResponse.parse(data);

                _sendMessageThroughSlack(buildSlackErrorMessage(response), slackEvent.channel);

                that._logger.log('error', response);
            }
        });
    };

    var _sendInProgressToSlackUser = function(supportId, slackEvent, commandText) {
        var inProgressMessage = util.format("Processing command: %s, SupportId: %s", commandText, supportId);
        _sendMessageThroughSlack(inProgressMessage, slackEvent.channel);
    };

    that.wireUpAmqpRequester = _wireUpAmqpRequester;
    that.sendInProgressToSlackUser = _sendInProgressToSlackUser;

    return that;
}

module.exports = SlackEventAcknowledger;