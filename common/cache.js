'use strict';
var helpers = require(__dirname + '/utils/helpers.js');

function Cache(client) {
    var that = this;
    that._client = client;

    // Private API
    var _storeSingleHash = function (key, value, cb) {
        that._client.hmset(key, value, cb);
    };

    var _retrieveSingleHash = function (key, cb) {
        that._client.hgetall(key, cb);
    };

    var _storeSingleExpiringHash = function (key, value, ttl, cb) {
        var setTtl = function () {
            that._client.expire(key, ttl, cb);
        };
        that._client.hmset(key, value, setTtl);
    };

    var _remove = function (key, cb) {
        that._client.del(key, cb);
    };

    var _setJSON = function (key, jsonValue, cb) {
        that._client.set(key, jsonValue, cb);
    };

    var _getJSON = function (key, cb) {
        that._client.get(key, cb);
    };

    var _setExpireAtInMs = function (key, endsAt, cb) {
        that._client.pexpireat(key, endsAt, cb);
    };

    var _setExpiringJSON = function (key, jsonValue, ttl, cb) {
        var setTtl = function () {
            that._client.expire(key, ttl, cb);
        };
        that._client.set(key, jsonValue, setTtl);
    };

    var _storeObject = function (key, value, cb) {
        that._client.set(key, JSON.stringify(value), cb);
    };

    var _storeExpiringObject = function (key, value, ttlSeconds, cb) {
        that._client.setex(key, ttlSeconds, JSON.stringify(value), cb);
    };

    var _retrieveObject = function (key, cb) {
        that._client.get(key, function (err, resultJson) {
            if (typeof resultJson === 'string') {
                cb(err, JSON.parse(resultJson));
            } else {
                cb(err, undefined);
            }
        });
    };

    // Public API
    that.storeSingleHash = _storeSingleHash;
    that.retrieveSingleHash = _retrieveSingleHash;
    that.storeSingleExpiringHash = _storeSingleExpiringHash;
    that.remove = _remove;
    that.storeJson = _setJSON;
    that.retrieveJson = _getJSON;
    that.setExpireAtInMs = _setExpireAtInMs;
    that.storeExpiringJson = _setExpiringJSON;
    that.storeObject = _storeObject;
    that.storeExpiringObject = _storeExpiringObject;
    that.retrieveObject = _retrieveObject;

    return that;
}

module.exports = Cache;