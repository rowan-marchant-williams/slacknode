module.exports = NegotiatedRequest;
NegotiatedRequest.NegotiatedRequest = NegotiatedRequest;

var und = require('underscore');
var Negotiator = require('negotiator');
var fs = require('fs');
var path = require('path');

function lowerCase(str) {
    return (str || '').toLowerCase();
}

function NegotiatedRequest(options, request, processPath) {
    if (!this instanceof NegotiatedRequest) return new NegotiatedRequest(options, request, processPath);

    if (!processPath) {
        processPath = path.dirname(process.argv[1]);
    }
    
    und.extend(this, getFilePathAndBestVariant(options, request, processPath));
}

function getFilePathAndBestVariant(options, req, processPath) {
    var negotiatedVariants = getNegotiatedVariants(options, req);
    var bestVariant;
    var filePath = '';

    var index = 0;
    for (index; index < negotiatedVariants.length; index++) {
        bestVariant = negotiatedVariants[index];

        filePath = buildFilePath(options, bestVariant, req, processPath);

        if (fs.existsSync(filePath)) {
            break;
        }
    }

    return {
        filePath: filePath,
        bestVariant: bestVariant
    };
}

function buildFilePath(options, variant, req, processPath) {
    var reqPath = req.path();

    var reqPathLastSlashPos = reqPath.lastIndexOf('/');

    var routePath = path.normalize(path.join(processPath, '..', 'public'));

    var filePath = '';

    if (options.useLang) {
        filePath = path.join(routePath,
            reqPath.substr(0, reqPathLastSlashPos),
            variant.language,
            reqPath.substr(reqPathLastSlashPos - reqPath.length)) +
            options.extension;

    } else {
        filePath = path.join(routePath,
            reqPath) +
            options.extension;
    }

    filePath = path.normalize(filePath);

    return filePath;
}

function getNegotiatedVariants(options, req) {
    var path = req.path();
    var pathWithNoLeadingSlash = path.charAt(0) == '/' ? path.substr(1) : path;
    var paths = pathWithNoLeadingSlash.split('/');
    var assetType = paths[0] !== 'secure' ? paths[0] : paths[1];
    var availableVariantsForAssetType = options.variants.filter(function(variant) {
        return variant.asset === assetType;
    });
    var availableLanguagesForAssetType = availableVariantsForAssetType.map(function(variant) {
        return variant.language.toLowerCase();
    });

    var negotiatedLanguages = new Negotiator(req).languages(availableLanguagesForAssetType);
    negotiatedLanguages.push('en');

    return negotiatedLanguages.map(function(language) {
       return und.find(availableVariantsForAssetType, function(variant) {
           return variant.language.toLowerCase() == language.toLowerCase();
       });
    });
}
