'use strict';

var common = __dirname;
var fs = require('fs');
var schemaCache = {};
var config = require('konphyg')(common + '/config');
var AmqpRequester = require('./amqp/requester');
var uuid = require('node-uuid');
var os = require('os');
var ProtoBuf = require('protobufjs');
var _ = require('underscore');
var convertToSchemaFormat = require('./convert-to-schema-format');
var convertFromSchemaFormat = require('./convert-from-schema-format');

ProtoBuf.convertFieldsToCamelCase = true;

function Request(requestNamespace) {

    var that = this;

    var TEN_SECONDS = 10 * 1000;  // Anapos uses Milliseconds
    var SERVICE_INDEX = 3;
    var START_OF_NAMESPACE_INDEX = 0;
    var METADATA_EXTENSION = '.metadata';
    var endOfNamespaceIndex;
    var requestParts = requestNamespace.split('.');
    var cfg;


    var _getGovernanceInfo = function () {
        endOfNamespaceIndex = (requestParts.length - 1);
        that._requestName = requestParts[endOfNamespaceIndex];
        that._requestNamespace = requestParts.slice(START_OF_NAMESPACE_INDEX, endOfNamespaceIndex).join('.');
        var metaName;
        if (3 === endOfNamespaceIndex) {
            that._protoFile = 'Governance';
            metaName = 'Governance';
        } else {
            that._protoFile = requestParts.slice(SERVICE_INDEX, endOfNamespaceIndex).join('.');
            metaName = requestParts[SERVICE_INDEX];
        }
        that._schemaIdentifier = requestNamespace;
        var metaFile = metaName.toString().toLowerCase() + METADATA_EXTENSION;
        cfg = config(metaFile);
    };


    var _findMessageTypeId = function () {
        var i;
        var cfg_message;
        for (i = 0; i < cfg.messages.length; i = i + 1) {
            cfg_message = cfg.messages[i];
            if (cfg.messages[i].name === that._schemaIdentifier) {
                that._messageTypeId = cfg.messages[i].constants[0].value;
                break;
            }
        }
    };


    var _findQueueName = function () {
        var i;
        that._QueueName = '';
        var cfg_message;
        for (i = 0; i < cfg.messages.length; i = i + 1) {
            cfg_message = cfg.messages[i];
            if (cfg_message.name === that._schemaIdentifier) {
                if (cfg_message.metadata) {
                    that._QueueName = cfg_message.metadata[0].value;
                    break;
                }
            }
        }
    };

    that._readSchema = function () {
        var protoFile = common + '/proto/' + that._protoFile + '.proto';
        var schemaName = that._protoFile.replace(/\./g,'');

        if (!schemaCache.hasOwnProperty(schemaName)) {
            schemaCache[schemaName] = ProtoBuf.loadProtoFile(protoFile);
        }

        that._schema = schemaCache[schemaName].build(that._schemaIdentifier);
        that._messageSchema = function(message) {
            convertToSchemaFormat(message, that._schema.$type._fields);
            return new that._schema(message);
        };

        _.extend(that._messageSchema, that._schema);
    };

    that._buildInstruction = function (body, req) {

        var sessionDetails = req.cookies && req.cookies['session-token'] && req._sessionDetails;

        var tenantCode = sessionDetails && sessionDetails.tenantCode || 'i2OGB';
        var username = sessionDetails && sessionDetails.username || body.username || 'system';
        var supportId = sessionDetails && sessionDetails.supportId || uuid.v1();

        that._instruction = {
            created: new Date().getTime(),
            id: req.getId(),
            source: 'Nodejs Request App',
            tenantCode: tenantCode,
            supportId: supportId,
            ttl: body.ttl || TEN_SECONDS,
            type: that._messageTypeId,
            sourceMachineName: os.hostname(),
            username: username,
            why: body.why || ''
        };
    };

    _getGovernanceInfo();
    _findMessageTypeId();
    _findQueueName();

    if (that._config) {
        that._config.amqp.qName = that._QueueName;
    }
    return that;
}

Request.prototype.parse = function (serialized) {
    this._readSchema();
    return convertFromSchemaFormat(this._schema.decode(serialized), this._schema.$type._fields);
};

Request.prototype.getMessageTypeId = function () {
    var that = this;
    return that._messageTypeId;
};

Request.prototype.getExpectedResponseTypeId = function () {
    var that = this;
    return that._goodResponseTypeId;
};

Request.prototype.execute = function (req, res, cb) {
    var HTTP_OK = 200;
    var HTTP_FORBIDDEN = 403;
    var HTTP_SERVICE_UNAVAILABLE = 503;
    var that = this;

    req.body = req.body || {};

    var errors = [];
    if (that.validateInputs) {
        errors = that.validateInputs(req.body);
    }

    if (errors.length === 0) {
        if (that.sanitize) {
            that.sanitize(req.body);
        }

        var serialized = that.serialize(req.body, req);
        var sendOptions = {
            exchange: '/',
            headers: {
                _req_resp_type_id: that.getExpectedResponseTypeId()
            },
            messageId: that.getMessageTypeId()
        };

        var requester = new AmqpRequester(that._config);

        requester.on('error', function (err) {
            if (err === 'request timeout') {
                cb(null, HTTP_SERVICE_UNAVAILABLE, { failureReason: 'Request Timeout', supportId: that._instruction.supportId });
            } else {
                cb(err);
            }
        });

        requester.on('data', function (data, msg) {
            var response;
            var rootResponse;
            if (msg.messageId === that._goodResponseTypeId) {
                response = that._myGoodResponse.parse(data);
                rootResponse = response.rootResponse;
                if (rootResponse.failure) {
                    cb(null, HTTP_FORBIDDEN, { failureReason: rootResponse.failure, supportId: rootResponse.instruction.supportId });
                } else {
                    cb(null, HTTP_OK, response);
                }
            } else if (msg.messageId === that._failureResponseTypeId) {
                response = that._myFailureResponse.parse(data);
                rootResponse = response.rootResponse;
                cb(null, HTTP_FORBIDDEN, { failureReason: rootResponse.failure, supportId: rootResponse.instruction.supportId });
            }
        });

        requester.send(sendOptions, serialized);
    } else {
        cb(null, HTTP_FORBIDDEN, { failureReason: 'invalid-characters-supplied', supportId: '' });
    }
};

module.exports = Request;
