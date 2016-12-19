'use strict';

function SlackEventAcknowledger() {
    var that = this;

    var _wireUpAmqpRequester = function(requester, responseOptions, res, cb) {

        requester.on('error', function(err) {
            var HTTP_SERVICE_UNAVAILABLE = 503;

            if (err === 'request timeout') {
                cb(null, HTTP_SERVICE_UNAVAILABLE, { failureReason: 'Request Timeout', supportId: responseOptions.supportId });
            } else {
                cb(err);
            }
        });

        requester.on('data', function (data, msg) {
            var HTTP_SERVER_ERROR = 500;
            var HTTP_FORBIDDEN = 403;
            var HTTP_OK = 200;
            var response;

            if (msg.messageId === responseOptions.goodResponseTypeId) {
                response = responseOptions.myGoodResponse.parse(data);

                if (cb) {
                    res.send(HTTP_OK);
                    cb(null, HTTP_OK, response);
                    return;
                }
                else {
                    res.send(HTTP_SERVER_ERROR, 'No Callback Provided');
                }
            } else if (msg.messageId === responseOptions.failureResponseTypeId) {
                response = responseOptions.myFailureResponse.parse(data);
                if (cb) {
                    cb(null, HTTP_FORBIDDEN, response);
                    return;
                }

                res.send(HTTP_SERVER_ERROR, 'No Callback Provided');
            }
        });
    };

    that.wireUpAmqpRequester = _wireUpAmqpRequester;
    return that;
}

module.exports = SlackEventAcknowledger;