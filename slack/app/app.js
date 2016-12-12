'use strict';

var common  = __dirname + '/../../common/';
var restify = require(common + 'node_modules/restify');
var config  = require('konphyg')(common + 'config');
var Logger  = require(common + 'logging/logger');
var Cache = require(common + 'cache');
var redis = require(common + 'node_modules/redis');
var RequestEngine = require('./modules/request-engine');
var uuid    = require('node-uuid');
var util    = require('util');
var helpers = require(common + 'utils/helpers');
var Resourcing = require(common + 'resourcing');
var und = require('underscore');

var Source = 'Slack App';

var configSettings = config('anapos');
configSettings     = helpers.myConfig(configSettings);  // Substitute any $machine$ settings on DEV

var _logger = {
	log: function(lvl, msg, dtl) {
		console.log(lvl + msg + dtl);
	}
};

var cacheClient = redis.createClient(configSettings.cache.port, configSettings.cache.host);
cacheClient.retry_delay = configSettings.cache.retry_delay;
cacheClient.retry_backoff = configSettings.cache.retry_backoff;

// Error Handling
cacheClient.on('error', function (err) {
    var logMessage = util.format('%s:Cache Client Error', Source);
    _logger.log('error', logMessage, err);
});

var _cache = new Cache(cacheClient);

var resourcing = new Resourcing(configSettings);

process.on('uncaughtException', function (err) {
    var logMessage = util.format('%s:Uncaught Exception(%s)', Source, err.message);
    _logger.log('error', logMessage, err);
    process.exit(1);
});

var restServer = restify.createServer({
    name: Source,
    version: '1.0.0'
});

restServer.on('error', function (err) {
    var msg = util.format('%s:REST Server Error(%s)', Source, err.message);
    _logger.log('error', msg, err);
});

restServer.on('clientError', function (err) {
    var msg = util.format('%s:Client Error(%s)', Source, err.message);
    _logger.log('error', msg, err);
});

var requestEngine = new RequestEngine(restServer, _logger, _cache);

restServer.use(restify.queryParser());
restServer.use(restify.bodyParser({ mapParams: false })); // It's important to include this before any custom async middleware (https://github.com/mcavage/node-restify/issues/287)

restServer.use(function (req, res, next) {
    //required for initial slack configuration:
    //slack validates urls setup for use with its events api
    //Slack validates by sending an initial request containing a challenge. The http endpoint
    //must respond with the challenge.
    if(req.body.challenge) {
        res.type('json')
        res.send({"challenge": req.body.challenge});
        return;
    }

    return next();
});

restServer.use(function (req, res, next) {
    var ensureRequestIsValid = function(req, res, next) {
        var HTTP_NOTFOUND = 404;
        var HTTP_OK = 200;
        var slackToken =  process.env.SLACK_VERIFICATION_TOKEN;

        var shouldHandle = function(evt) {
            var handledEventType = "message";
            return (evt.type === handledEventType && !evt.bot_id);
        }

        if(!slackToken || !req.body.token || slackToken !== req.body.token) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        if(!req.body.event || !req.body.event.type || !req.body.event.channel) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        //no action required for message types that are not handled, just return HTTP_OK
        if(!shouldHandle(req.body.event)) {
            res.send(HTTP_OK);
            return;
        }

        return next();
    };

    ensureRequestIsValid(req, res, next);
});

restServer.use(function (req, res, next) {
    var ensureUserIsAuthorized = function(req, res, next) {
        var authorizedUsers = [
            {id: "U3CRV4XBP", name: "rowanhwilliams"},
            {id: "U37E5LNS3", name: "rowanwilliams999"}
        ];

        if(!req.body.event.user) {
            res.send(HTTP_OK);
            return;
        }

        var authorizeEntry = und.filter(authorizedUsers, function(x){return x.id === req.body.event.user;})[0];

        if(!authorizeEntry) {
            res.send(HTTP_OK);
            return;
        }

        return next();
    };

    ensureUserIsAuthorized(req, res, next);
});

restServer.use(function (req, res, next) {
    var support_id = req.headers['x-support-id'] || _logger.supportId();
    if (!res.header('x-support-id')) {
        res.header('x-support-id', support_id);
    }

    return next();
});

restServer.use(restify.gzipResponse());

// Slack adminbot endpoint
restServer.post(/\/requests\/(adminbot)/, requestEngine.sendRequest);

var port = process.env.port || 1337;
restServer.listen(port, function () {
    var msg = util.format('%s:Listening on port %d', Source, port);
    _logger.log('info', msg);
});