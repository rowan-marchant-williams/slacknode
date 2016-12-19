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

var TEN_SECONDS = 10 * 1000; // Anapos uses Milliseconds

function SupportBotRequest(config, botSettings) {
    var that = this;
    that._config = config;
    that._botSettings = botSettings;
    that._myGoodResponse = new Request('i2OWater.Anapos.Governance.Support.Responses.ExecuteResponse');
    that._goodResponseTypeId = that._myGoodResponse.getMessageTypeId();
    that._myFailureResponse = new Request('i2OWater.Anapos.Governance.FailureResponse');
    that._failureResponseTypeId = that._myFailureResponse.getMessageTypeId();

    return that;
}

SupportBotRequest.prototype = new Request('i2OWater.Anapos.Governance.Support.Requests.ExecuteRequest');

SupportBotRequest.prototype.serialize = function (body, req, res, onSerialized) {
    var that = this;
    that._buildInstruction(body, req);
    that._readSchema();

    that._instruction.ttl = that._config.request.ttl || TEN_SECONDS;

    var slackEvent = req.body.event;
    var username = res.header("x-username");

    var runSerialize = function(commandText, fileInput) {
        var adminRequest = {
            rootRequest: {
                instruction: that._instruction
            },
            externalUsername: username,
            externalUserId: slackEvent.channel,
            command: commandText,
            fileInput: fileInput
        };

        that._config.amqp.qName = that._QueueName;
        var serialized = new that._messageSchema(adminRequest);
        return serialized.toBuffer();
    };

    var slackEventMapper = new SlackEventMapper(that._botSettings);
    slackEventMapper.toSerializedMessage(slackEvent, runSerialize, onSerialized);
};

SupportBotRequest.prototype.execute = function (req, res, cb) {
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

        var slackEventAcknowledger = new SlackEventAcknowledger();

        var responseOptions = {
            supportId: that._instruction.supportId,
            goodResponseTypeId: that._goodResponseTypeId,
            myGoodResponse: that._myGoodResponse,
            failureResponseTypeId: that._failureResponseTypeId,
            myFailureResponse: that._myFailureResponse
        };

        slackEventAcknowledger.wireUpAmqpRequester(requester, responseOptions, res, cb);

        requester.send(sendOptions, serialized);
    };

    that.serialize(req.body, req, res, onSerialized);
};

module.exports = SupportBotRequest;