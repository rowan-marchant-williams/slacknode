'use strict';

var und = require('underscore');

function SlackRequest(logger, slackSettings) {
    var that = this;

    that._slackSettings = slackSettings;
    that._logger = logger;

    var getRequestedResource = function(req) {
        var requestedResource;
        if (req.params) {
            if (req.params[1]) {
                requestedResource = req.params[1];
            } else if (req.params[0]) {
                requestedResource = req.params[0];
            }
        }
        return requestedResource;
    };

    var botConfigForRequest = function(req) {
        var requestedResource = getRequestedResource(req);

        var botConfig = und.find(that._slackSettings.bots, function(x) {
            return x.requestedResource === requestedResource;
        });

        return botConfig;
    };

    var replyWithChallenge = function (req, res, next) {
        var HTTP_OK = 200;
        //required for initial slack configuration:
        //slack validates urls setup for use with its events api
        //Slack validates by sending an initial request containing a challenge. The http endpoint
        //must respond with the challenge.
        if(req.body.challenge) {
            res.setHeader("content-type","application/json");
            res.send(HTTP_OK, {"challenge": req.body.challenge});
            return;
        }

        return next();
    };

    var logInDebug = function(req, res, next){
        if(!process.env.NODE_ENV || process.env.NODE_ENV === "DEVELOPMENT") {
            that._logger.log('info', "Received request: " + JSON.stringify(req.body));
        }

        return next();
    };

    var ensureSlackVerificationToken = function(req, res, next){
        var HTTP_NOTFOUND = 404;
        var botConfig = botConfigForRequest(req);

        if(!botConfig) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        var slackToken = botConfig.settings.slackVerification;

        if (!slackToken || !req.body.token || slackToken !== req.body.token) {
            res.send(HTTP_NOTFOUND);
            return;
        }

        return next();
    };

    var ensureRequestIsValid = function (req, res, next) {
        var HTTP_NOTFOUND = 404;
        var HTTP_OK = 200;

        var shouldHandle = function (evt) {
            var handledEventType = "message";
            return (evt.type === handledEventType && !evt.bot_id);
        };

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

    var ensureUserIsAuthorized = function (req, res, next) {
        var HTTP_OK = 200;

        var botConfig = botConfigForRequest(req);

        if(!botConfig) {
            res.send(HTTP_OK);
            return;
        }

        var authorizedUsers = botConfig.settings.authorizedUsers;

        if(!authorizedUsers) {
            res.send(HTTP_OK);
            return;
        }

        var userIdLocations = [
            {prop: req.body.event.user,     selector: function() {return req.body.event.user}},
            {prop: req.body.event.message,  selector: function() {return req.body.event.message.user}},
            {prop: req.body.event.comment,  selector: function() {return req.body.event.comment.user}}
        ];

        var userIdSelector = und.find(userIdLocations, function(x){return x.prop});
        if(!userIdSelector) {
            res.send(HTTP_OK);
            return;
        }

        var userId = userIdSelector.selector();
        if (!userId) {
            res.send(HTTP_OK);
            return;
        }

        var authorizedEntry = und.find(authorizedUsers, function (x) {
            return x.id === userId;
        });

        if (!authorizedEntry) {
            res.send(HTTP_OK);
            return;
        }

        res.header('x-username', authorizedEntry.name);

        return next();
    };

    var addSupportIdHeader = function (req, res, next) {
        var support_id = req.headers['x-support-id'] || that._logger.supportId();
        if (!res.header('x-support-id')) {
            res.header('x-support-id', support_id);
        }

        return next();
    };

    that.replyWithChallenge = replyWithChallenge;
    that.logInDebug = logInDebug;
    that.ensureSlackVerificationToken = ensureSlackVerificationToken;
    that.ensureRequestIsValid = ensureRequestIsValid;
    that.ensureUserIsAuthorized = ensureUserIsAuthorized;
    that.addSupportIdHeader = addSupportIdHeader;

    return that;
}

module.exports = SlackRequest;