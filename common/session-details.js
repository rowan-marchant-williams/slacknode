'use strict';

var util = require('util');

module.exports = function (_cache, _logger, nextCb) {

    var cache = _cache;
    var logger = _logger;
    var nextFn = function(next) {
        if (nextCb) {
            return nextCb(next);
        }
        next();
    };

    return function sessionDetailsStorer(req, res, next) {
        var cookies = req.cookies;

        if (cache &&
            cookies && cookies['session-token'])
        {

            var _onSessionRetrievedFromCache = function(err, sessionDetails) {

                if (err || typeof sessionDetails !== 'object') {
                    logger.log('info', util.format('Could not retrieve session token %s from redis', cookies['session-token']));
                    return nextFn(next);
                }

                req._sessionDetails = {
                    username: sessionDetails.username,
                    tenantCode: sessionDetails.tenantCode,
                    tenantShortName: sessionDetails.tenantShortName,
                    supportId: sessionDetails.supportId,
                    antiCsrfToken: sessionDetails.antiCsrfToken
                };

                nextFn(next);
            };

            cache.retrieveObject(cookies['session-token'], _onSessionRetrievedFromCache);
        }
        else {
            next();
        }
    }

};