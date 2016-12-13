'use strict';

var common  = __dirname + '/../../common/';
var restify = require(common + 'node_modules/restify');
var config  = require('konphyg')(common + 'config');
var Logger  = require(common + 'logging/logger');
var RequestEngine = require('./modules/request-engine');
var uuid    = require('node-uuid');
var util    = require('util');
var helpers = require(common + 'utils/helpers');
var Resourcing = require(common + 'resourcing');
var und = require('underscore');

var Source = 'Slack App';

var configSettings = config('anapos');
configSettings = helpers.myConfig(configSettings);  // Substitute any $machine$ settings on DEV

var _logger = (function configureLogging() {
    var loggerOptions = configSettings.logging || {
            tenantCode: 'i2OGB',
            logFile: 'anapos.log',
            level: 'debug',
            colorize: true
        };
    loggerOptions.supportId = uuid.v1();
    loggerOptions.source = Source;
    loggerOptions.cfg = configSettings;

    return new Logger(loggerOptions);
})();

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

var requestEngine = new RequestEngine(restServer, _logger);

restServer.use(restify.queryParser());
restServer.use(restify.bodyParser({mapParams: false})); // It's important to include this before any custom async middleware (https://github.com/mcavage/node-restify/issues/287)

restServer.use(function (req, res, next) {
    //required for initial slack configuration:
    //slack validates urls setup for use with its events api
    //Slack validates by sending an initial request containing a challenge. The http endpoint
    //must respond with the challenge.
    if(req.body.challenge) {
        res.setHeader("content-type","application/json")
        res.send(200, {"challenge": req.body.challenge});
        return;
    }

    return next();
});

restServer.use(function(req, res, next){
    var slackToken = process.env.SLACK_VERIFICATION_TOKEN;

    if (!slackToken || !req.body.token || slackToken !== req.body.token) {
        res.send(HTTP_NOTFOUND);
        return;
    }

    return next();
});

restServer.use(function(req, res, next){
    _logger.log('info', "Received request: " + JSON.stringify(req.body));
    return next();
});

restServer.use(function (req, res, next) {
    var ensureRequestIsValid = function (req, res, next) {
        var HTTP_NOTFOUND = 404;
        var HTTP_OK = 200;

        var shouldHandle = function (evt) {
            var handledEventType = "message";
            return (evt.type === handledEventType && !evt.bot_id);
        }

        if (!req.body.event || !req.body.event.type || !req.body.event.channel) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        //no action required for message types that are not handled, just return HTTP_OK
        if (!shouldHandle(req.body.event)) {
            res.send(HTTP_OK);
            return;
        }

        return next();
    };

    ensureRequestIsValid(req, res, next);
});

restServer.use(function (req, res, next) {
    var ensureUserIsAuthorized = function (req, res, next) {
        var authorizedUsers = [
            {id: "U3CRV4XBP", name: "rowanhwilliams"},
            {id: "U37E5LNS3", name: "rowanwilliams999"}
        ];

        if (!req.body.event.user) {
            res.send(HTTP_OK);
            return;
        }

        var authorizedEntry = und.filter(authorizedUsers, function (x) {
            return x.id === req.body.event.user;
        })[0];

        if (!authorizedEntry) {
            res.send(HTTP_OK);
            return;
        }

        res.header('x-username', authorizedEntry.name);

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