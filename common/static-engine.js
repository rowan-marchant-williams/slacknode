var helpers = require('./utils/helpers');
var Cache = require('./cache');

function StaticEngine(config) {
    function load(opts, req, res, next) {
        var options = {
            useLang: opts.useLang,
            extension: opts.extension,
            variants: config.proxy.locales.variants,
            cache: opts.cache
        };

        helpers.getContent(options, req, res, next);
    }

    function coalesce() {
    }

    coalesce();

    return {
        load: load
    };
}

module.exports = StaticEngine;
