// Takes array of applications, each one should have `root` property,
// and does the following:
//
// - Normalize structure of each config.
// - Resolve file paths.
// - Merge all of the configs into one and return.
//


'use strict';


var _    = require('lodash');
var fs   = require('fs');
var path = require('path');
var resolveModulePath = require('./resolve_module_path');


var RESOURCE_NAMES = [
  'bin'
, 'server'
, 'client'
, 'views'
, 'styles'
, 'i18n_client'
, 'i18n_server'
];


////////////////////////////////////////////////////////////////////////////////


// Returns normalized version of vendor section of a package definition.
// Resolves all file paths relative to `app.root` using `resolveModulePath`.
//
// NOTE: Normalized vendor section is different from the config origin. In the
// configs it is an array of `alias` to `file` mappings or just `file` strings.
// The normalized is `file` to `names array` mapping. "name" means both absolute
// file path and all of the aliases.
//
// Config:
//
// ```
// vendor:
//   - "./path/to/foo.js"
//   - bar_alias: "./path/to/bar.js"
// ```
// 
// Normalized:
//
// ```
// vendor:
//   "/absolute/path/to/foo.js": ["/absolute/path/to/foo.js"]
//   "/absolute/path/to/bar.js": ["/absolute/path/to/bar.js", "bar_alias"]
// ```
//
function normalizeVendor(app, config) {
  var result = {};

  _.forEach(config, function (vendorPkg) {
    var filename, alias;

    if (_.isPlainObject(vendorPkg)) {
      alias = _.keys(vendorPkg);

      if (1 === alias.length) {
        alias    = alias[0];
        filename = vendorPkg[alias];
      } else {
        throw new Error('Ill-formed list of vendor files.');
      }
    } else {
      alias    = null;
      filename = vendorPkg;
    }

    filename = resolveModulePath(app.root, filename);

    result[filename] = alias ? [filename, alias] : filename;
  });

  return result;
}


// Returns normalized version of the given resource definition:
//
// client:
//   pkgName: admin
//   root: /absolute/path/
//   main: /absolute/path/to/script.js
//   include: [ ... ]
//   exclude: [ ... ]
//
// Resources are: bin, server, client, views, styles, i18n_client, i18n_server
//
function normalizeResource(app, pkgName, config) {
  if (!config) {
    return null;
  }

  var result = {
    pkgName: pkgName
  , root:    null
  , main:    null
  , include: []
  , exclude: []
  };

  result.root = path.resolve(app.root, config.root || '.');

  if (config.main) {
    result.main = config.main;
  }

  ['include', 'exclude'].forEach(function (filter) {
    result[filter] = result[filter].concat(config[filter]);
  });

  return result;
}


// Returns normalized version of the given package definition. Creates all
// possible sections with the given or default values:
//
// admin:
//   depends:     [ ... ]
//   vendor:      { ... }
//   bin:         { ... }
//   server:      { ... }
//   client:      { ... }
//   views:       { ... }
//   styles:      { ... }
//   i18n_client: { ... }
//   i18n_server: { ... }
//
// common:
//   ...
//
// users:
//   ...
//
function normalizePackages(app, config) {
  var result = {};

  _.forEach(config, function (pkgConfig, pkgName) {
    result[pkgName] = {
      depends: _([ pkgConfig.depends ]).flatten().compact().valueOf()
    , vendor:  normalizeVendor(app, pkgConfig.vendor)
    };

    _.forEach(RESOURCE_NAMES, function (resource) {
      result[pkgName][resource] = [];
    });

    _.forEach(RESOURCE_NAMES, function (resource) {
      var normalized = normalizeResource(app, pkgName, pkgConfig[resource]);

      if (normalized) {
        result[pkgName][resource].push(normalized);
      }
    });
  });

  return result;
}


// Merges full config tree from `source` into `target`.
//
function mergeConfig(target, source) {
  if (_.isArray(target)) {
    _.forEach((_.isArray(source) ? source : [ source ]), function (object) {
      if (object && !_.contains(target, object)) {
        target.push(object);
      }
    });
  } else {
    _.forEach(source, function (value, key) {
      if (_.isObject(target[key])) {
        mergeConfig(target[key], value);
      } else {
        target[key] = value;
      }
    });
  }

  return target;
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function (applications) {
  var appConfigs = []
    , mergedConfigs;

  // Read (not merge!) all of available configs.
  _.forEach(applications, function (app) {
    var file   = path.join(app.root, 'bundle.yml')
      , config = null;

    if (fs.existsSync(file)) {
      config = require(file);

      appConfigs.push({
        packages: normalizePackages(app, config.packages)
      , bundles:  config.bundles
      });
    }
  });

  // Ensure there is only *one* `main` file per package.
  _(appConfigs).pluck('packages').map(_.keys).flatten().unique().forEach(function (pkgName) {
    _.forEach(RESOURCE_NAMES, function (resource) {
      var hasMain = false;

      _.forEach(appConfigs, function (config) {
        var pkgConfig = config.packages[pkgName];

        if (pkgConfig && _.find(pkgConfig[resource], 'main')) {
          if (hasMain) {
            throw new Error(resource + ' resource of ' + pkgName + ' package ' +
                            'contains multiple `main` file declarations');
          } else {
            hasMain = true;
          }
        }
      });
    });
  });

  // Merge all apps configs into one.
  mergedConfigs = _.reduce(appConfigs, mergeConfig, {});

  // Ensure existence of the declared dependences.
  _.forEach(mergedConfigs.packages, function (pkgConfig, pkgName) {
    _.forEach(pkgConfig.depends, function (depName) {
      if (!mergedConfigs.packages[depName]) {
        throw new Error('"' + pkgName + '" package depends on a non-existent ' +
                        '"' + depName + '" package');
      }
    });
  });

  return mergedConfigs;
};
