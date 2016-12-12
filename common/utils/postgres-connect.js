'use strict';
var common = __dirname + '/../../common/';
var config = require('konphyg')(common + '/config');
var helpers = require(common + 'utils/helpers');
var pg = require(common +'node_modules/pg');
var cfg = config('anapos');
cfg = helpers.myConfig(cfg);  // Substitute any $machine$ settings on DEV

function PostgresConnect(options) {
    var that = this;
    
    // Private fields
    that._options = options;

    // Private API
    var connectAndExecuteQuery = function(req, tenantCode, queryDetails, callback) {
        var tenantCode = tenantCode || req.tenantCode;
        if (!tenantCode) {
            callback('No Tenant Code found');
        }
        var tenantDatabaseName = cfg.postgresql.machine_name + '.' + tenantCode;
        var connected = function(err, client, done) {
            if (err) {
                that._options.logger.logRequest('warning', that._options.source, req, 'Error connecting to PG. ' + tenantDatabaseName + ' ' + err);
                return callback(err); // will call next in callback
            }
            client.query(queryDetails.sql, queryDetails.values, function (err, result) {
                done(); // hand connection back to pool
                callback(err, result);
            });
        };

        pg.connect({
            host: cfg.postgresql.host,
            port: cfg.postgresql.port,
            ssl: cfg.postgresql.ssl,
            database: tenantDatabaseName,
            user: cfg.postgresql.user,
            password: cfg.postgresql.password
        }, connected);
    };
    
    that.connectAndExecuteQuery = connectAndExecuteQuery;
}

module.exports = PostgresConnect;