var express = require('express');
var app = express();
var fs = require("fs");

var bodyParser = require('body-parser')
app.use( bodyParser.json() );
app.use(bodyParser.urlencoded({
    extended: true
}));

app.post('/slackevent', function (req, res) {
    console.log( req.body );
    res.status(200);
})

var server = app.listen(80, function () {

    var host = server.address().address
    var port = server.address().port

    console.log("Example app listening at http://%s:%s", host, port)

})