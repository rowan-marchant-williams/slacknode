var should = require('should');
var Logger = require('../logging/logger');
var config = require('konphyg')(__dirname + '/config');
var uuid = require('node-uuid');

describe('Logger', function () {
    var options =  {
        tenantCode: 'i2OGB',
        source: 'logger.test.js',
        supportId: uuid.v1(),
        logFile : 'anapos.log',
        level: 'debug',
        colorize: true,
        cfg: config('anapos')
    };

    describe('Logging', function () {
        it('should be able to log bare info', function (done) {
            var logger = new Logger(options);
            logger.log('info', 'This is an Information Message', {}, function () {
                done();
            });
        });
        it('should be able to log bare debug', function (done) {
            var logger = new Logger(options);
            logger.log('debug', 'This is a Debug Message', {}, function () {
                done();
            });
        });
        it('should be able to log without passing metadata and get callback', function (done) {
            var logger = new Logger(options);
            logger.log('info', 'This is an Information Message', function () {
                done();
            });
        });
        it('should be able to log passing undefined metadata and get callback', function (done) {
            var logger = new Logger(options);
            logger.log('info', 'This is an Information Message', undefined, function () {
                done();
            });
        });
        it('should be able to log passing null metadata and get callback', function (done) {
            var logger = new Logger(options);
            logger.log('info', 'This is an Information Message', null, function () {
                done();
            });
        });
        it('should be able to log error', function (done) {
            var logger = new Logger(options);
            try {
                undefined.no_chance();
            } catch (err) {
                logger.log('error', err.message, err, function () {
                    done();
                });
            }
        });
        it('should be able to log warning with additional data', function (done) {
            var logger = new Logger(options);
            var meta = {
                day: 'Today',
                time: 'Now',
                request: {
                    a: 1,
                    b: '2'
                }
            };
            logger.log('warning', 'This is a Warning Message', meta, function () {
                done();
            });
        });
    });
});

