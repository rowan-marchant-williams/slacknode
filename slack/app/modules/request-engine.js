'use strict';

var common = __dirname + '/../../../common/';
var helpers = require(common + 'utils/helpers.js');
var util = require('util');
var os = require('os');
var restify = require(common + 'node_modules/restify');
var async = require('async');
var uuid = require('node-uuid');
var ServiceRequestEngine = require('./service-request-engine');
var ExecutionCompleteHandler = require('./execution-complete-handler');
var AmqpSubscriber = require(common + 'amqp/subscriber');

function RequestEngine(server, logger, config, slackSettings) {

    var ROUTING_TYPE = 'topic';
    var that = this;
    that._logger = logger;

    that._serviceRequestEngine = new ServiceRequestEngine(that._logger, slackSettings);

    that._enterpriseEventHandlers = [];

    slackSettings.bots.forEach(function (bot) {
        var subscriptionSettings = bot.settings.serviceEventSubscription;

        var subscriptionQueue = subscriptionSettings.subscriberQueueName + '.' + os.hostname();

        var subscriptionOptions = {
            durable: true,
            autoDelete: false,
            qName: subscriptionQueue,
            topic: subscriptionSettings.topic,
            routingType: ROUTING_TYPE
        }

        var subscriber = new AmqpSubscriber(config, that._logger, subscriptionOptions);
        var handler = new ExecutionCompleteHandler(subscriber, that._logger, config, bot.settings);
        that._enterpriseEventHandlers.push(handler);
    });

    function _onServerClosed() {
        that._enterpriseEventHandlers.forEach(function(handler){
            handler.destroy();
        })
    }

    server.on('close', _onServerClosed);

    var _requestSender = function (req, res, next) {
        if (!req.header('x-support-id')) {
            req.header('x-support-id', uuid.v1());
        }
		
		that._logger.log('info', 'amqp.host: ' + config.amqp.host);

        that._serviceRequestEngine.makeServiceRequest(req, res, next);
    };

    that.sendRequest = _requestSender;

    return that;
}

module.exports = RequestEngine;
