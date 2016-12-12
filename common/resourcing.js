'use strict';

var NegotiatedRequest = require('./negotiated-request');
var fs = require('fs');
var Mustache = require('mustache');
var path = require('path');

function Resourcing(config) {

    var that = this;
    var processPath = path.dirname(process.argv[1]);
    var viewAppPath = path.normalize(path.join(processPath, '..', '..', 'view', 'app'));

    var _resourceView = function(req, res, next) {
        var unresourcedBody = res._body;

        req._path = '/views/resources';

        var negotiatedRequest = new NegotiatedRequest({
            useLang: true,
            extension: '.json',
            variants: config.proxy.locales.variants
        }, req, viewAppPath);

        fs.readFile(negotiatedRequest.filePath, 'utf8', function (err, data) {
            if (err && err.code === 'ENOENT') {
                return next(new restify.WrongAcceptError());
            }

            var context = new Mustache.Context(JSON.parse(data));
            context.lookup = function(key) {
                // Return the key if the lookup doesn't return a value
                return Mustache.Context.prototype.lookup.call(this, key) == null ? key : Mustache.Context.prototype.lookup.call(this, key);
            };

            res._body = Mustache.render(unresourcedBody, context);

            return next();
        });
    };

    var _resourceRequestError = function(req, res, next) {
        if (!res._err) return next();

        var err = res._err;

        req._path = '/views/resources';

        var negotiatedRequest = new NegotiatedRequest({
            useLang: true,
            extension: '.json',
            variants: config.proxy.locales.variants
        }, req, viewAppPath);

        fs.readFile(negotiatedRequest.filePath, 'utf8', function (fileErr, data) {
            if (err && err.code === 'ENOENT') {
                return next(new restify.WrongAcceptError());
            }

            err.message.failureDescription = Mustache.render('{{' + (err.message.failureReason || err.message) + '}}', JSON.parse(data));

            res._err = err;

            return next(res._err);
        });

    };

    // Public API
    that.resourceRequestError = _resourceRequestError;
    that.resourceView = _resourceView;

    return that;
}

module.exports = Resourcing;