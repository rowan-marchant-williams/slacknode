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

function RequestEngine(server, logger) {

    var ROUTING_TYPE = 'topic';
    var TOPIC = 'Anapos.Admin.ExecutionInConsoleComplete';
    var SUBSCRIBER_Q_NAME = 'admin.ee';
    var HTTP_NOT_MODIFIED = 304;

    var that = this;
    that._logger = logger;
    var config = helpers.getConfig();
    config = helpers.myConfig(config);

    var eeQueueName = SUBSCRIBER_Q_NAME + '.' + os.hostname();
    var opts = {
        durable: true,
        autoDelete: false,
        qName: eeQueueName,
        topic: TOPIC,
        routingType: ROUTING_TYPE
    };

    that._adminExecutionCompleteSubscriber = new AmqpSubscriber(config, that._logger, opts);
    that._serviceRequestEngine = new ServiceRequestEngine(that._logger);
    that._executionCompleteHandler = new ExecutionCompleteHandler(that._adminExecutionCompleteSubscriber, that._logger, config);

    function _onServerClosed() {
        that._executionCompleteHandler.destroy();
    }

    server.on('close', _onServerClosed);

    var _requestSender = function (req, res, next) {
        if (!req.header('x-support-id')) {
            req.header('x-support-id', uuid.v1());
        }

        that._serviceRequestEngine.makeServiceRequest(req, res, next);
    };

    that.sendRequest = _requestSender;

    return that;
}

module.exports = RequestEngine;
