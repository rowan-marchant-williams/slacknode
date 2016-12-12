'use strict';

var common = __dirname + '/../../../common/';
var helpers = require(common + 'utils/helpers.js');
var util = require('util');
var restify = require(common + 'node_modules/restify');
var async = require('async');
var fs = require('fs');

function ServiceRequestEngine(logger) {

    var Source = 'Service Request Engine';
    var HTTP_BAD_REQUEST = 400;
    var HTTP_NOT_MODIFIED = 304;
    var HTTP_OK = 200;

    var that = this;
    that._logger = logger;

    var _makeRequest = function (req, res, callback) {
        var _onChangeMade = function (err, result) {
            if (err) {
                callback(err, result);
            } else {
                var changeResult = {
                    requestId : req.getId(),
                    result : result
                };
                callback(null, changeResult);
            }
        };
        var _execute = function (req, res, cb) {

            var msg;
            var _getConfig = function () {
                var config = helpers.getConfig();
                config     = helpers.myConfig(config);
                return config;
            };

            var serviceRequest;
            if (req.params) {
                // for the moment we need to look up the serviceRequest using [1]
                // 1 is actual a property of the params object.
                // this is important as params is not an array so we cant test the .length
                // property and we cannot group the regex results into a named group
                // this could mean if we move the serviceRequest position in the uri then
                // this code could fall over - DOL 14-03-2012
                if (req.params[1]) {
                    serviceRequest = req.params[1];
                } else if (req.params[0]) {
                    serviceRequest = req.params[0];
                }
            }

            if (serviceRequest) {
                var requestFileName = __dirname + '/requests/' + serviceRequest + '.js';
                var _onFileStatObtained = function (err, stats) {
                    if (err) {
                        if ('ENOENT' === err.code) {
                            msg = util.format('%s:Could not find Request Javascript File %s', Source, requestFileName);
                            that._logger.log('error', msg, err, function logError() {
                                cb(err);
                            });
                        } else {
                            cb(err);
                        }
                    }
                    if (stats.isFile()) {
                        var RequestModule      = require(requestFileName);
                        var serviceRequest     = new RequestModule(_getConfig());
                        var _onRequestExecuted = function (err, status, result) {
                            if (err) {
                                cb(err);
                            } else if (HTTP_OK === status) {
                                cb(null, HTTP_OK);
                            } else {
                                cb(new restify.RestError({
                                    statusCode: status,
                                    restCode: null,
                                    message: result
                                }));
                            }
                        };
                        serviceRequest.execute(req, res, _onRequestExecuted);
                    } else {
                        msg = util.format('%s:Found Request Javascript File but it was not a File! %s', Source, requestFileName);
                        that._logger.log('error', msg, function logError() {
                            cb(err);
                        });
                    }
                };

                fs.stat(requestFileName, _onFileStatObtained);
            } else {
                msg = util.format('%s:Did not get passed the Request', Source);
                that._logger.log('error', msg, function logError() {

                    cb(new restify.RestError({
                        statusCode: HTTP_BAD_REQUEST,
                        restCode: msg,
                        message: null
                    }));
                });
            }
        };
        _execute(req, res, _onChangeMade);
    };

    that.makeServiceRequest = _makeRequest;
    return that;
}

module.exports = ServiceRequestEngine;
