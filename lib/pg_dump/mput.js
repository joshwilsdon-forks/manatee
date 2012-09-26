#!/usr/bin/env node
// -*- mode: js -*-
// Copyright (c) 2012, Joyent, Inc. All rights reserved.

var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var url = require('url');

var bunyan = require('bunyan');
var getopt = require('posix-getopt');
var restify = require('restify');
var uuid = require('node-uuid');

var manta = require('manta');



///--- Globals

var LOG = bunyan.createLogger({
        name: path.basename(process.argv[1]),
        level: (process.env.LOG_LEVEL || 'info'),
        stream: process.stderr,
        serializers: restify.bunyan.serializers
});



///--- Functions

function ifError(err) {
        if (err) {
                console.error(err.toString());
                process.exit(1);
        }
}


function parseOptions() {
        var option;
        var opts = {};
        var parser = new getopt.BasicParser('vc:f:h:k:u:a:',
                                            process.argv);
        var tmp;

        while ((option = parser.getopt()) !== undefined && !option.error) {
                switch (option.option) {
                case 'a':
                        opts.user = option.optarg;
                        break;

                case 'c':
                        opts.copies = parseInt(option.optarg, 10);
                        break;

                case 'f':
                        opts.file = option.optarg;
                        break;

                case 'h':
                        opts.host = option.optarg;
                        break;

                case 'k':
                        opts.keyPath = option.optarg;
                        break;

                case 'u':
                        opts.url = url.parse(option.optarg).href;
                        break;

                case 'v':
                        // Allows us to set -vvv -> this little hackery
                        // just ensures that we're never < TRACE
                        LOG.level(Math.max(bunyan.TRACE, (LOG.level() - 10)));
                        if (LOG.level() <= bunyan.DEBUG)
                                LOG = LOG.child({src: true});
                        break;

                default:
                        process.exit(1);
                        break;
                }

        }

        if (!opts.url && !process.env.MANTA_URL)
                usage('url is a required argument');

        if (!opts.user && !process.env.MANTA_USER)
                usage('account is a required argument');

        if (!opts.keyPath && !process.env.MANTA_KEY_PATH)
                usage('key is a required argument');

        if (!opts.file)
                usage('file is a required argument');

        if (parser.optind() >= process.argv.length)
                usage('missing required argument: "path"');

        opts.keyPath = opts.keyPath || process.env.MANTA_KEY_PATH;
        opts.path = path.normalize(process.argv[parser.optind()]);
        opts.url = opts.url || process.env.MANTA_URL;
        opts.user = opts.user || process.env.MANTA_USER;
        return (opts);
}


function printEntry(obj) {
        console.log('%j', obj);
}


function usage(msg) {
        if (msg)
                console.error(msg);

        var str = 'usage: ' + path.basename(process.argv[1]);
        str += '[-v] [-a account] [-c copies] [-u url] [-k keyId] -f file path';
        console.error(str);
        process.exit(1);
}



///--- Mainline
// Leading _ to avoid scope conflicts in functions

var _options = parseOptions();
var _client = null;

var privateKey = _options.keyPath + '/id_rsa';
var publicKey = _options.keyPath + '/id_rsa.pub';
var cmd = 'ssh-keygen -l -f ' +
        publicKey + ' ' +
        '| awk \'{print $2}\'';

fs.readFile(privateKey, 'utf8', function (err, key) {
        if (err)
                throw err;

        exec(cmd, function (err2, stdout, stderr) {
                if (err2)
                        return (cb(err2));

                _client = manta.createClient({
                        connectTimeout: 1000,
                        log: LOG,
                        retry: true,
                        sign: manta.privateKeySigner({
                                key: key,
                                keyId: stdout.replace('\n', ''),
                                user: _options.user
                        }),
                        url: _options.url,
                        user: _options.user
                });

                fs.stat(_options.file, function (err, stats) {
                        ifError(err);

                        if (!stats.isFile()) {
                                console.error(_options.file + ' is not a file');
                                process.exit(1);
                        }

                        var opts = {
                                copies: _options.copies,
                                size: stats.size
                        };

                        var stream = fs.createReadStream(_options.file);
                        stream.pause();
                        stream.on('open', function () {
                                _client.put(_options.path, stream, opts,
                                            function (err)
                                {
                                        ifError(err);
                                        process.exit(0);
                                });
                        });
                });

        });
});
