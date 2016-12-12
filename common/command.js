'use strict';

var common = __dirname;
var fs = require('fs');
var schemaCache = {};
var config = require('konphyg')(common + '/config');
var AmqpRequester = require(common + '/amqp/requester');
var uuid = require('node-uuid');
var os = require('os');
var ProtoBuf = require('protobufjs');
var _ = require('underscore');
var convertToSchemaFormat = require('./convert-to-schema-format');
var convertFromSchemaFormat = require('./convert-from-schema-format');

ProtoBuf.convertFieldsToCamelCase = true;

function Command(commandNamespace) {

    var that = this;

    var SERVICE_INDEX = 3;
    var START_OF_NAMESPACE_INDEX = 0;
    var CLASSIFICATION_INDEX = 4;
    var END_OF_NAMESPACE_INDEX = 5;
    var METADATA_EXTENSION = '.metadata';

    var commandParts = commandNamespace.split('.');
    var cfg;

    if ('FailureResponse' === commandParts[SERVICE_INDEX]) {
        cfg = config('governance' + METADATA_EXTENSION);
        that._protoFile = 'Governance';
        that._commandName = 'FailureResponse';
        that._commandNamespace = 'i2OWater.Anapos.Governance';
        that._schemaIdentifier = 'i2OWater.Anapos.Governance.FailureResponse';
    } else {

        if ('EnterpriseEvents' === commandParts[SERVICE_INDEX]) {
            cfg  = config(commandParts[CLASSIFICATION_INDEX].toString().toLowerCase() + METADATA_EXTENSION);
        } else {
            cfg  = config(commandParts[SERVICE_INDEX].toString().toLowerCase() + METADATA_EXTENSION);
        }

        END_OF_NAMESPACE_INDEX =   commandParts.length - 1;

        that._protoFile = commandParts.slice(SERVICE_INDEX, END_OF_NAMESPACE_INDEX).join('.');
        that._commandName = commandParts[END_OF_NAMESPACE_INDEX].toString();
        that._commandNamespace = commandParts.slice(START_OF_NAMESPACE_INDEX, END_OF_NAMESPACE_INDEX).join('.');
        that._schemaIdentifier = that._commandNamespace + '.' + that._commandName;
    }

    function findMessageTypeId() {
        var i;
        var cfg_message;
        for (i = 0; i < cfg.messages.length; i = i + 1) {
            cfg_message = cfg.messages[i];
            if (cfg_message.name === that._schemaIdentifier) {
                that._messageTypeId = cfg_message.constants[0].value;
                break;
            }
        }
    }

    function findQueueName() {
        var i;
        that._QueueName = '';
        var cfg_message;
        for (i = 0; i < cfg.messages.length; i = i + 1) {
            cfg_message = cfg.messages[i];
            if (cfg_message.name === that._schemaIdentifier) {
                if (cfg.messages[i].metadata) {
                    that._QueueName = cfg_message.metadata[0].value;
                    break;
                }
            }
        }
    }

    that._readSchema = function () {
        var protoFile = common + '/proto/' + that._protoFile + '.proto';
        var schemaName = that._protoFile.replace('.','');

        if (!schemaCache.hasOwnProperty(schemaName)) {
            schemaCache[schemaName] = ProtoBuf.loadProtoFile(protoFile);
        }

        that.schema = schemaCache[schemaName].build(that._commandNamespace + '.' + that._commandName);
        that.command = function(command) {
            convertToSchemaFormat(command, that.schema.$type._fields);
            return new that.schema(command);
        };

        _.extend(that.command, that.schema);
    };

    that._buildInstruction = function (body, tenantCode) {
        that._instruction = {
            created: new Date().getTime(),
            id: uuid.v1(),
            source: 'Nodejs Command App',
            tenantCode: tenantCode || 'i2OGB',
            supportId: body.support_id || uuid.v1(),
            type: that._messageTypeId,
            sourceMachineName: os.hostname(),
            username: body.username || 'system',
            why: body.why || 'non-given'
        };
    };

    findMessageTypeId();
    findQueueName();

    if (that._config) {
        that._config.amqp.qName = that._QueueName;
    }
    return that;
}

Command.prototype.parse = function (serialized) {
    this._readSchema();
    return convertFromSchemaFormat(this.schema.decode(serialized), this.schema.$type._fields);
};

Command.prototype.getMessageTypeId = function () {
    return this._messageTypeId;
};

Command.prototype.execute = function (req, res, cb) {
    var that = this;

    req.body = req.body || {};

    var serialized = that.serialize(req.body, req);
    var sendOpts = {
        exchange: '/',
        headers: {
            _req_resp_type_id: that.getExpectedResponseTypeId()
        },
        messageId: that.getMessageTypeId()
    };

    var requester = new AmqpRequester(that.config);

    requester.on('error', function (err) {
        if (err === 'request timeout') {
            if (cb) {
                cb(503, msg);
            } else {
                res.send(500, 'No Callback Provided');
            }
        } else {
            res.send(err);
        }
    });

    requester.on('data', function (data, msg) {
        var response;
        var rootResponse;
        if (msg.messageId === that._goodResponseTypeId) {
            response = that._myGoodResponse.parse(data);
            // check the result and return in to front end?
            if (response.rootResponse.failure === undefined) {
                if (cb) {
                    cb(200, response);
                } else {
                    res.send(500, 'No Callback Provided');
                }
            } else {
                if (response.rootResponse.failure) {
                    if (cb) {
                        rootResponse = response.rootResponse;
                        cb(403, {
                            failureReason: rootResponse.failure,
                            supportId: rootResponse.instruction.supportId
                        });
                    } else {
                        res.send(500, 'No Callback Provided');
                    }
                }
            }
        } else if (msg.messageId === that._failureResponseTypeId) {
            response = that._myFailureResponse.parse(data);
            rootResponse = response.rootResponse;
            if (cb) {
                cb(403, {failureReason: rootResponse.failure, supportId: rootResponse.instruction.supportId});
            } else {
                res.send(500, 'No Callback Provided');
            }
        }
    });

    requester.send(sendOpts, serialized);
};

module.exports = Command;
