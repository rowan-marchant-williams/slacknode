'use strict';

var common = __dirname + '/../../../../common/';
var Request = require(common + 'request');
var AmqpRequester = require(common + 'amqp/requester');
var helpers = require(common + 'utils/helpers');
var uuid = require('node-uuid');
var util = require('util');
var fs = require('fs');
var config  = require('konphyg')(common + 'config');
var SlackEventMapper = require('../slack-event-mapper');
var SlackEventAcknowledger = require('../slack-event-acknowledger');
var md5 = require('md5');

var TEN_SECONDS = 10 * 1000; // Anapos uses Milliseconds

function AdminBotRequest(config, botSettings, logger) {
    var that = this;
    that._config = config;
    that._botSettings = botSettings;
    that._logger = logger;
    that._myGoodResponse = new Request('i2OWater.Anapos.Governance.Admin.Responses.ExecuteResponse');
    that._goodResponseTypeId = that._myGoodResponse.getMessageTypeId();
    that._myFailureResponse = new Request('i2OWater.Anapos.Governance.FailureResponse');
    that._failureResponseTypeId = that._myFailureResponse.getMessageTypeId();

    return that;
}

AdminBotRequest.prototype = new Request('i2OWater.Anapos.Governance.Admin.Requests.ExecuteRequest');

AdminBotRequest.prototype.serialize = function (body, req, res, onSerialized) {
    var that = this;
    that._buildInstruction(body, req);
    that._readSchema();

    that._instruction.ttl = that._config.request.ttl || TEN_SECONDS;

    var slackEvent = req.body.event;
    var username = res.header("x-username");
    var fingerprint = md5(JSON.stringify(slackEvent));

    var runSerialize = function(commandText, fileInput) {
        var adminRequest = {
            rootRequest: {
                instruction: that._instruction
            },
            externalUsername: username,
            externalUserId: slackEvent.channel,
            command: commandText,
            fingerprint: fingerprint,
            fileInput: fileInput
        };

        that._config.amqp.qName = that._QueueName;
        var serialized = new that._messageSchema(adminRequest);
        return serialized.toBuffer();
    };

    var slackEventMapper = new SlackEventMapper(that._botSettings);
    slackEventMapper.toSerializedMessage(slackEvent, that._instruction.supportId, runSerialize, onSerialized);
};

AdminBotRequest.prototype.execute = function (req, res) {
    var that = this;

    var onSerialized = function(serialized, slackEvent, commandText, supportId) {
        var slackEventAcknowledger = new SlackEventAcknowledger(that._logger, that._botSettings);

        var maxMessageSizeInMB = 10;
        if(serialized.length > (maxMessageSizeInMB * 1000000)) {
            var tooBigMessage = util.format("The requested message is over the permitted %dMB size. Please ensure the message is less than %dMB in size", maxMessageSizeInMB, maxMessageSizeInMB);
            slackEventAcknowledger.sendMessageThroughSlack(tooBigMessage, slackEvent.channel);
            return;
        }
        
        var sendOptions = {
            exchange: '/',
            headers: {
                _req_resp_type_id: that.getExpectedResponseTypeId()
            },
            messageId: that.getMessageTypeId()
        };

        var requester = new AmqpRequester(that._config);

        var responseOptions = {
            supportId: that._instruction.supportId,
            goodResponseTypeId: that._goodResponseTypeId,
            myGoodResponse: that._myGoodResponse,
            failureResponseTypeId: that._failureResponseTypeId,
            myFailureResponse: that._myFailureResponse
        };

        slackEventAcknowledger.wireUpAmqpRequester(requester, responseOptions, supportId, slackEvent);

        requester.send(sendOptions, serialized);

        slackEventAcknowledger.sendInProgressToSlackUser(supportId, slackEvent, commandText);
    };

    that.serialize(req.body, req, res, onSerialized);
};

module.exports = AdminBotRequest;