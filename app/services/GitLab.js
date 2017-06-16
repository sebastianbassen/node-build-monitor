var request = require('request'),
async = require('async');

var now = function () {
  return (new Date()).getTime();
},
second = 1000,
minute = second * 60;

module.exports = function () {
  var self = this;

  self.cache = {
    expires: now(),
    projects: {}
  };

  function log() {
    if (self.config.debug) {
      var msg = [new Date().toLocaleTimeString(), '| GitLab |'];
      for (var i in arguments) {
        msg.push(arguments[i]);
      }
      console.log.apply(this, msg);
    }
  }

  function getDefaultExpiration() {
    return now() + self.config.intervals.disabled;
  }

  function getProjectExpiration(project) {
    if (project.builds_enabled !== true) {
      return getDefaultExpiration();
    } else if (!Object.keys(project.builds).length) {
      return now() + self.config.intervals.empty;
    } else {
      return now() + self.config.intervals.default;
    }
  }

  function getBuildExpiration(build) {
    if (build.status !== 'running') {
      return getDefaultExpiration();
    } else {
      return now();
    }
  }

  function getRequestHeaders() {
    return {
      'PRIVATE-TOKEN': self.config.token
    };
  }

  function getProjectsApiUrl(page, per_page) {
    var base = self.config.url + '/',
    query = '?page=' + page + '&per_page=' + per_page;
    return base + 'api/v3/projects' + query;
  }

  function getProjectBuildsApiUrl(project, page, per_page) {
    var base = self.config.url + '/',
    query = '?page=' + page + '&per_page=' + per_page;
    return base + 'api/v3/projects/' + project.id + '/builds' + query;
  }

  function getBuildApiUrl(project, build) {
    var base = self.config.url + '/';
    return base + 'api/v3/projects/' + project.id + '/builds/' + build.id;
  }

  function getBuildId(project, build) {
    return project.id + '-' + build.ref + '-' + build.stage;
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildNumber(project, build) {
    return project.name_with_namespace;
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildProject(project, build) {
    return build.ref;
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildIsRunning(project, build) {
    return (build.status === 'running' ||
    build.status === 'pending');
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildStartedAt(project, build) {
    return new Date(build.started_at);
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildFinishedAt(project, build) {
    return new Date(build.finished_at);
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildRequestedFor(project, build) {
    return build.commit && build.commit.author_name;
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildStatus(project, build) {
    switch (build.status) {
      case 'pending':
      return '#ffa500';
      case 'running':
      return 'Blue';
      case 'failed':
      return 'Red';
      case 'success':
      return 'Green';
      default:
      return 'Gray';
    }
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildStatusText(project, build) {
    return build.stage + ' ' + build.status;
  }

  //noinspection JSUnusedLocalSymbols
  function getAvatarForBuild(project, build) {
    return build.user.avatar_url;
  }

  //noinspection JSUnusedLocalSymbols
  function getBuildReason(project, build) {
    return build.commit && build.commit.message;

  }

  function getBuildUrl(project, build) {
    var base = self.config.url + '/';
    return base + project.path_with_namespace + '/builds/' + build.id;
  }

  function getBuildMonitorBuild(project, build) {
    return {
      id: getBuildId(project, build),
      number: getBuildNumber(project, build),
      project: getBuildProject(project, build),
      isRunning: getBuildIsRunning(project, build),
      startedAt: getBuildStartedAt(project, build),
      finishedAt: getBuildFinishedAt(project, build),
      requestedFor: getBuildRequestedFor(project, build),
      status: getBuildStatus(project, build),
      statusText: getBuildStatusText(project, build),
      avatarUrl: getAvatarForBuild(project, build),
      reason: getBuildReason(project, build),
      hasErrors: false,
      hasWarnings: false,
      url: getBuildUrl(project, build)
    };
  }

  function requestFirstPage(getPagedApiUrl, callback) {
    log('Fetching', getPagedApiUrl(1, 100));
    request({
      headers: getRequestHeaders(),
      url: getPagedApiUrl(1, 100),
      json: true
    }, function (err, response, body) {
      if (!err && response.statusCode == 200) {
        process.nextTick(function () {
          callback(body);
        });
      } else {
        log('Error', body);
        process.nextTick(function () {
          callback([]);
        });
      }
    });
  }

  function requestAllPages(getPagedApiUrl, callback) {
    log('Fetching', getPagedApiUrl(1, 100));
    request({
      headers: getRequestHeaders(),
      url: getPagedApiUrl(1, 100),
      json: true
    }, function (err, response, body) {
      if (!err && response.statusCode == 200) {
        var urls = [], pages = Math.ceil(
          parseInt(response.headers['x-total-pages'], 10));
          for (var i = 2; i <= pages; i = i + 1) {
            urls.push(getPagedApiUrl(i, 100));
          }

          process.nextTick(function () {
            callback(body);
          });

          async.mapSeries(urls, function (url, pass) {
            log('Fetching', url);
            request({
              headers: getRequestHeaders(),
              url: url,
              json: true
            }, function (err, response, body) {
              if (!err && response.statusCode == 200) {
                process.nextTick(function () {
                  callback(body);
                });
                process.nextTick(function () {
                  pass(null, body);
                });
              } else {
                log('Error', body);
                process.nextTick(function () {
                  callback([]);
                });
                process.nextTick(function () {
                  pass(null, []);
                });
              }
            });
          });
        } else {
          log('Error', body);
          process.nextTick(function () {
            callback([]);
          });
        }
      });
    }

    function updateBuild(project, build, callback) {
      log('Fetching', getBuildApiUrl(project, build));
      request({
        headers: getRequestHeaders(),
        url: getBuildApiUrl(project, build),
        json: true
      }, function (err, response, body) {
        if (!err && response.statusCode == 200) {
          body.monitor = getBuildMonitorBuild(project, body);
          body.expires = getBuildExpiration(body);
          project.builds[body.monitor.id] = body;
          if (typeof callback === 'function') {
            process.nextTick(function () {
              callback(body);
            });
          }
        } else {
          log('Error', body);
          if (typeof callback === 'function') {
            process.nextTick(function () {
              callback(build);
            });
          }
        }
      });
    }

    function reduceBuilds(builds, callback) {
      const seen = {};
      let latest = null;

      results = builds
      .filter(build => {
        const key = build.monitor.id;
        if (typeof seen[key] === 'undefined') {
          seen[key] = build;
          return true;
        }
        else if (seen[key].monitor.startedAt < build.monitor.startedAt) {
          seen[key] = build;
          return true;
        } else {
          return false;
        }
      })
      .filter(build => {
        if (!latest || build.monitor.startedAt > latest) {
          latest = build.monitor.startedAt;
          return true;
        } else {
          return build.monitor.isRunning || build.status === 'failing';
        }
      });

      if (typeof callback === 'function') {
        process.nextTick(function () {
          callback(results);
        });
      }
    }

    function fetchProjectBuilds(project, callback) {
      requestFirstPage(function (page, per_page) {
        return getProjectBuildsApiUrl(project, page, per_page);
      }, function (results) {
        results.forEach((build, index) => {
          results.find(item => item.id === build.id).monitor = getBuildMonitorBuild(project, build);
          results.find(item => item.id === build.id).expires = getBuildExpiration(build);
        });

        process.nextTick(function () {
          reduceBuilds(results, function (results) {
            if (results.length) {
              log(project.name_with_namespace + ' | ' +
              results.length + ' current builds.');
            }
            process.nextTick(function () {
              callback(results);
            });
          });
        });
      });
    }

    function updateProject(project, callback) {
      log('Updating project:', project.name_with_namespace);
      if (self.config.slugs.indexOf('*/*') > -1 || self.config.slugs.indexOf(project.namespace.name + "/*")  > -1 || self.config.slugs.indexOf(project.path_with_namespace) > -1) {
        if (typeof project.builds === 'undefined') {
          project.builds = {};
        }
        if (project.builds_enabled === true) {
          fetchProjectBuilds(project, function(results) {
            var i, build, builds = {};
            for (i = 0; i < results.length; i = i + 1) {
              build = results[i];
              builds[build.monitor.id] = build;
            }
            if (Object.keys(builds).length) {
              project.builds = builds;
            }
            project.expires = getProjectExpiration(project);
            self.cache.projects[project.id] = project;
            if (typeof callback === 'function') {
              process.nextTick(function() {
                callback(project);
              });
            }
          });
        } else {
          project.builds = {};
          project.expires = getProjectExpiration(project);
          self.cache.projects[project.id] = project;
          if (typeof callback === 'function') {
            process.nextTick(function() {
              callback(project);
            });
          }
        }
      } else {
        if (typeof callback === 'function') {
          process.nextTick(function() {
            callback(project);
          });
        }
      }
    }

    function fetchNewProjects(callback) {
      self.cache.expires = getDefaultExpiration();

      log('Fetching new projects...');
      requestAllPages(getProjectsApiUrl, function (projects) {
        projects
        .filter(project => project.builds_enabled)
        .forEach(project => {
          updateProject(project);
        });

        log('Found', projects.length + ' new projects.');
        if (typeof callback === 'function') {
          process.nextTick(function () {
            callback(projects);
          });
        }
      });
    }

    self.check = function (callback) {
      // Trigger fetch for new projects
      if (now() > self.cache.expires) {
        process.nextTick(fetchNewProjects);
      }

      // Iterate through already cached projects
      async.mapSeries(Object.keys(self.cache.projects),
      function (key, pass) {
        var project = self.cache.projects[key];

        // Trigger fetch for new builds for projects with expired cache
        if (now() > project.expires) {
          process.nextTick(function () {
            updateProject(project);
          });
        }

        // Iterate through already cached builds for the project
        async.mapSeries(Object.keys(project.builds),
        function (key, pass) {
          var build = project.builds[key];

          // Trigger fetch for build with expired cache
          if (now() > build.expires) {
            process.nextTick(function () {
              updateBuild(project, build);
            });
          }

          // Pass along the monitor version of the build info
          process.nextTick(function () {
            pass(null, build.monitor);
          });
        }, function (err, results) {

          // Pass along all project builds
          process.nextTick(function () {
            pass(null, results);
          });
        });
      }, function (err, builds) {

        // Reduce builds from all projects into a flat array
        async.reduce(builds, [], function (memo, item, pass) {
          process.nextTick(function () {
            pass(null, memo.concat(item));
          });
        }, function (err, builds) {
          process.nextTick(function () {
            callback(err, builds);
          });
        });
      });
    };

    self.configure = function (config) {
      self.config = config;
      if (typeof self.config.intervals === 'undefined') {
        self.config.intervals = {};
      }
      if (typeof self.config.intervals.disabled === 'undefined') {
        self.config.intervals.disabled = 12 * 60 * minute;
      }
      if (typeof self.config.intervals.empty === 'undefined') {
        self.config.intervals.empty = 10 * minute;
      }
      if (typeof self.config.intervals.default === 'undefined') {
        self.config.intervals.default = minute;
      }
      if (typeof self.config.slugs === 'undefined') {
        self.config.slugs = ['*/*'];
      }
      if (typeof process.env.GITLAB_TOKEN !== 'undefined') {
        self.config.token = process.env.GITLAB_TOKEN;
      }
      if (typeof self.config.caPath !== 'undefined') {
        request = request.defaults({
          agentOptions: {
            ca: require('fs').readFileSync(self.config.caPath).toString().split("\n\n")
          }
        });
      }
      for (var key in self.config) {
        if (key !== 'token') {
          log(key + ':', self.config[key]);
        }
      }
    };
  };
