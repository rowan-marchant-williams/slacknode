'use strict';
var path = require('path');
var fs = require('fs');
var winston = require('winston');
require('winston-papertrail').Papertrail;
var uuid = require('node-uuid');
var util = require('util');

function Logger(options) {
    var that = this;

    // Constants
    var DEFAULT_LOGDIR = './logs';

    // Private fields
    that._options = options ||
        {
            tenantCode: 'i2OGB',
            source: 'Anapos Logger',
            logFile: 'anapos.log',
            level: 'debug',
            colorize: true
        };

    if (!that._options.supportId) {
        that._options.supportId = uuid.v1();
    }

    // Private functions
    var _makeLogFilePath = function () {
        return path.join(DEFAULT_LOGDIR, that._options.logFile);
    };

    var _init = function () {
        if (!fs.existsSync(DEFAULT_LOGDIR)) {
            fs.mkdirSync(DEFAULT_LOGDIR);
        }
        that._options.filename = _makeLogFilePath();

        var loggerTransports = [
            new (winston.transports.Console)(that._options),
            new (winston.transports.File)(that._options)
        ];

        if (that._options.paperTrail && that._options.paperTrail.enabled) {
            loggerTransports.push(new winston.transports.Papertrail({
                host: that._options.paperTrail.host,
                port: that._options.paperTrail.port,
                level: that._options.paperTrail.level,
                inlineMeta: that._options.paperTrail.inlineMeta,
                program: that._options.source,
                colorize: that._options.colorize
            }));
        }

        that._logger = new (winston.Logger)({
            level: 'debug',
            transports: loggerTransports
        });

        that._logger.exitOnError = false;
        that._logger.setLevels(winston.config.syslog.levels);
    };

    // Initialise
    _init();

    // Public API
    that.log = function (level, shortMessage, metadata, cb) {
        if ('undefined' === typeof metadata || null === metadata) {
            metadata = {};
        }
        if ('function' === typeof metadata) {
            cb = metadata;
            metadata = {};
        }
        metadata.support_id = that._options.supportId;
        that._logger.log(level, shortMessage, metadata, cb);
    };

    that.supportId = function () {
        return that._options.supportId;
    };

    that.logRequest = function (level, source, request, customMessage, cb) {
        var metadata = {
            method: request.method,
            url: request.url,
            headers: request.headers,
            trailers: request.trailers
        };
        var msg = util.format('HTTP Request Received by %s.', source, customMessage || '');
        that.log(level, msg, metadata, cb);
    };

    that.logResponse = function (level, source, response, cb) {
        var metadata = {
            method: response._method,
            code: response.statusCode
        };
        var msg = util.format('HTTP Response Produced by %s', source);
        that.log(level, msg, metadata, cb);
    };

    return that;
}

module.exports = Logger;
