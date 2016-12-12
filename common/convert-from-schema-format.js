var _ = require('underscore');

var numberTypes = ['sfixed64'];

module.exports = function convertFromSchemaFormat (msg, fields) {
    var val;
    if (Array.isArray(msg)) {
        msg.forEach(function(entry, index) {
            msg[index] = convertFromSchemaFormat(entry, fields);
        });
    } else {
        Object.keys(msg).forEach(function (key) {
            var field = _.where(fields, {name: key})[0];

            if (field && msg[key]) {
                if (field.resolvedType) {
                    msg[key] = convertFromSchemaFormat(msg[key], field.resolvedType._fields);
                } else if (_.contains(numberTypes, field.type.name)) {
                    val = msg[key].toNumber();
                    msg[key] = val;
                } else if (field.type.name === 'bytes') {
                    val = msg[key].toBuffer();
                    msg[key] = val;
                }
            }
        });
    }
    return msg;
};