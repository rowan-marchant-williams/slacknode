'use strict';
var exports = exports || this,
    require = require || function () {
        return exports;
    };

(function () {
    var common = __dirname + '/../';
    var fs = require('fs');
    var restify = require('restify');
    var config = require('konphyg')(common + 'config');
    var Logger = require(common + 'logging/logger');
    var uuid = require('node-uuid');
    var crypto = require('crypto');
    var und = require('underscore');
    var NegotiatedRequest = require(common + 'negotiated-request');

    var hasOwnProperty = Object.prototype.hasOwnProperty;

    function partial(fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function(){
            var arg = 0;
            for (var i = 0; i < args.length && arg < arguments.length; i++) {
                if (args[i] === undefined) {
                    args[i] = arguments[arg++];
                }
            }
            return fn.apply(this, args);
        }
    }

    function isEmpty(obj) {
        var key;
        if (obj.length && obj.length > 0) {
            return false;
        }

        for (key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                return false;
            }
        }
        return true;
    }

    function calcEtag(filePath, cb) {
        var etag;
        fs.stat(filePath, function (err, stats) {
            if (cb) {
                if (!err) {
                    etag = stats.size + '-' + Number(stats.mtime);
                }
                cb(err, etag, stats);
            }
        });
    }

    function loadContent(filePath, cb) {

        fs.readFile(filePath, 'utf8', function (err, data) {
            if (err && err.code === 'ENOENT') {
                return next(new restify.WrongAcceptError());
            }
            if (cb) {
                cb(err, data);
            }
        });
    }

    function setResponseContentType(req, res, bestVariantMatch, variants) {
        var i;
        if (bestVariantMatch.type) {
            if (req.path().indexOf(bestVariantMatch.asset) !== -1) {
                var type = bestVariantMatch.type;
                if (bestVariantMatch.charset) {
                    type = type + '; ' + bestVariantMatch.charset;
                }

                res.contentType = type;
            } else {
                for (i = 0; i < variants.length; i++) {
                    if (req.path().indexOf(variants[i].asset) !== -1) {
                        res.contentType = variants[i].type + '; ' + variants[i].charset;
                        break;
                    }
                }
            }
        }
    }

    function makeEtag(opts, req, res, next) {
        var options = opts || {
            useLang: true,
            extension: '.json',
            variants: []
        };

        var negotiatedRequest = new NegotiatedRequest(opts, req);

        calcEtag(negotiatedRequest.filePath, function (err, etag, stats) {
            if (err && err.code === 'ENOENT') {
                return next(new restify.WrongAcceptError());
            }

            res.header('Content-Language', negotiatedRequest.bestVariant.language);
            setResponseContentType(req, res, negotiatedRequest.bestVariant, opts.variants);

            if (negotiatedRequest.filePath.match(/keep\-alive/)) {
                res.header('Cache-Control', 'private');
                return next();
            } else {
                var lastModified = new Date(stats.mtime);
                res.header('etag', etag);
                res.header('Last-Modified', lastModified);
                return next();
            }
        });
    }


    function respondWithContent(opts, res, content) {
        var httpStatusOk = 200;
        if (opts.extension === '.json') {
            // Only park the content as we may want to filter it
            res._body = JSON.parse(content);

        } else if (opts.extension === '.html') {
            // Only park the content as we may want to filter it
            res._body = content;
        } else if (opts.extension === '.js') {
            // We don't expect any other processing on the content so we can just bail out here
            res.send(httpStatusOk, content);
        }
    }

    function getContent(opts, req, res, next) {
        var negotiatedRequest = new NegotiatedRequest(opts, req);

        calcEtag(negotiatedRequest.filePath, function (err, etag) {
            if (err) {
                return next(err);
            }

            res.header('Content-Language', negotiatedRequest.bestVariant.language);
            setResponseContentType(req, res, negotiatedRequest.bestVariant, opts.variants);

            // Try Cache
            if (opts.cache && opts.cache.connected) {
                opts.cache.get(etag, function (err, data) {
                    if (err) {
                        return next(err);
                    } else {
                        if (data && !isEmpty(data)) {
                            respondWithContent(opts, res, data);
                            return next();
                        } else {
                            loadContent(negotiatedRequest.filePath, function (err, content) {
                                respondWithContent(opts, res, content);
                                return next();
                            });
                        }
                    }
                });
            } else {
                loadContent(negotiatedRequest.filePath, function (err, content) {
                    respondWithContent(opts, res, content);
                    return next();
                });
            }
        });
    }

    function getDefaultLogger() {
        var configSettings = config('anapos');
        var loggerOptions = configSettings.logging || {
            tenantCode: 'i2OGB',
            logFile: 'anapos.log',
            level: 'debug',
            colorize: true
        };
        loggerOptions.supportId = uuid.v1();
        loggerOptions.source = 'Anapos Node.js View App';
        loggerOptions.cfg = configSettings;

        return new Logger(loggerOptions);
    }

    function getDefaultConfig() {
        return config('anapos');
    }

    function getSaltHash(text) {
        var config = getDefaultConfig();
        var masterSalt = config.security.master_salt;
        var combined = masterSalt + text;
        var shasum = crypto.createHash(config.security.hash_algorithm);
        shasum.update(combined);
        return shasum.digest(config.security.digest);
    }

    function personaliseConfig(config) {
        var machine = process.env.WIN_MACHINE ? process.env.WIN_MACHINE : 'test';   // Substitute any local DEV settings
        config.amqp = und.defaults(config.amqp, { vhost: machine });
        config.cassandra = und.defaults(config.cassandra, { keyspace: machine });
        config.elasticsearch = und.defaults(config.elasticsearch, { machine_name: machine });
        config.postgresql = und.defaults(config.postgresql, { machine_name: machine });
        return config;
    }

    function setSupportIdFromRequestOrLogger(req, logger) {
        var supportId = uuid.v1();
        if (req.headers && req.headers['x-support-id']) {
            supportId = req.headers['x-support-id'];
        } else if (logger && 'function' === typeof (logger.supportId)) {
            supportId = logger.supportId();
        }
        return supportId;
    }

    function isNonEmptyArray(maybeArr) {
        return und.isArray(maybeArr) && !und.isEmpty(maybeArr);
    }

    function isNonEmptyString(maybeStr) {
        return und.isString(maybeStr) && !und.isEmpty(maybeStr);
    }

    exports.partiallyApply = partial;
    exports.makeEtag = makeEtag;
    exports.calcEtag = calcEtag;
    exports.getContent = getContent;
    exports.getLogger = getDefaultLogger;
    exports.getConfig = getDefaultConfig;
    exports.getSaltHash = getSaltHash;
    exports.myConfig = personaliseConfig;
    exports.setSupportId = setSupportIdFromRequestOrLogger;
    exports.isNonEmptyArray = isNonEmptyArray;
    exports.isNonEmptyString = isNonEmptyString;
}());
