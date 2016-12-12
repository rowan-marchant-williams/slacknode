var testFiles=[__dirname +"/../filtering.test.js"];
var Mocha = require('mocha');

var mocha = new Mocha({timeout: 7000});
mocha.reporter('spec').ui('bdd');

for (var i =0;i<testFiles.length;i++){
    mocha.addFile(testFiles[i]);
}

var runner = mocha.run(function(){
    console.log('finished');
});
