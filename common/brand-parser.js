'use strict';
var und = require('underscore');
var config  = require('konphyg')(__dirname + '/config');
var availableBrands = config('anapos').branding;

module.exports = function(req, res, next) {
    var host = req.header('x-forwarded-host') || req.header('host'); // apache first, then non-apache

    var currentBrand = und.find(availableBrands, function(brandEntry) {
        return host.search(brandEntry.subdomainSuffix + '.' + brandEntry.hostname) !== -1;
    });

    req._brand = (typeof currentBrand === 'object') ? currentBrand.name : 'default';

    next();
};