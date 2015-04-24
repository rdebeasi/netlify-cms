import Ember from 'ember';
/* global Base64 */

/**
@module app
@submodule backends
*/

var Promise = Ember.RSVP.Promise;
var ENDPOINT = "https://api.github.com/";


/**
 Github API repository backend.

 This backend uses the Git Data API to create commits when updateFiles is called.

 @class GithubAPI
 */
class GithubAPI {
  /**
    Sets up a new Github API backend

    Must be instantiated with a github_access_token in the credentials.

    The config requires a `repo` and a `branch`.

    @method constructor
    @param {Config} config
    @param {Object} credentials
    @return {GithubAPI} github_backend
  */
  constructor(config, credentials) {
    this.base = ENDPOINT + "repos/" + config.repo;
    this.branch = config.branch;
    this.token = credentials.github_access_token;
  }

  /**
    Read the content of a file in the repository

    @method readFile
    @param {String} path
    @return {String} content
  */
  readFile(path) {
    return this.request(this.base + "/contents/" + path, {
      headers: {Accept: "application/vnd.github.VERSION.raw"},
      data: {ref: this.branch},
      cache: false
    });
  }

  /**
    Get a list of files in the repository

    @method listFiles
    @param {String} path
    @return {Array} files
  */
  listFiles(path) {
    return this.request(this.base + "/contents/" + path, {
      data: {ref: this.branch}
    });
  }

  /**
    Update files in the repo with a commit.

    A commit message can be specified in `options` as `message`.

    @method updateFiles
    @param {Array} files
    @param {Object} options
    @return {Promise} result
  */
  updateFiles(files, options) {
    var file, filename, part, parts, subtree;
    var fileTree = {};
    var files = [];

    for (var i=0, len=uploads.length; i<len; i++) {
      file = uploads[i];
      if (file.uploaded) { continue; }
      files.push(file.upload ? file : this.uploadBlob(file));
      parts = file.path.split("/").filter((part) => part);
      filename = parts.pop();
      subtree = fileTree;
      while (part = parts.shift()) {
        subtree[part] = subtree[part] || {};
        subtree = subtree[part];
      }
      subtree[filename] = file;
      file.file = true;
    }
    return Promise.all(files)
      .then(this.getBranch)
      .then((branchData) => this.updateTree(branchData.commit.sha, "/", fileTree))
      .then((changeTree) => {
        return this.request(base + "/git/commits", {
          type: "POST",
          data: JSON.stringify({message: options.message, tree: changeTree.sha, parents: [changeTree.parentSha]})
        });
      }).then((response) => {
        return this.request(base + "/git/refs/heads/" + branch, {
          type: "PATCH",
          data: JSON.stringify({sha: response.sha})
        });
      });
  }

  request(url, settings) {
    return Ember.$.ajax(url, Ember.$.extend(true, {
      headers: {Authorization: "Bearer " + this.token},
      contentType: "application/json"
    }, settings || {}));
  }

  getBranch() {
    return this.request(this.base + "/branches/" + this.branch, {cache: false});
  }

  getTree(sha) {
    return sha ? this.request(this.base + "/git/trees/" + sha) : Promise.resolve({tree: []});
  }

  uploadBlob(file) {
    return this.request(this.base + "/git/blobs", {
      type: "POST",
      data: JSON.stringify({
        content: file.base64 ? file.base64() : Base64.encode(file.content),
        encoding: "base64"
      })
    }).then((response) => {
      file.sha = response.sha;
      file.uploaded = true;
      return file;
    });
  }

  updateTree(sha, path, fileTree) {
    return this.getTree(sha)
      .then((tree) => {
        var obj, filename, fileOrDir;
        var updates = [];
        var added = {};

        for (var i=0, len=tree.tree.length; i<len; i++) {
          obj = tree.tree[i];
          if (fileOrDir = fileTree[obj.path]) {
            added[obj.path] = true;
            if (fileOrDir.file) {
              updates.push({path: obj.path, mode: obj.mode, type: obj.type, sha: fileOrDir.sha});
            } else {
              updates.push(this.updateTree(obj.sha, obj.path, fileOrDir));
            }
          }
        }
        for (filename in fileTree) {
          fileOrDir = fileTree[filename];
          if (added[filename]) { continue; }
          updates.push(
            fileOrDir.file ?
              {path: filename, mode: "100644", type: "blob", sha: fileOrDir.sha} :
              this.updateTree(null, filename, fileOrDir)
          );
        }
        return Promise.all(updates)
          .then(function(updates) {
            return this.request(this.base + "/git/trees", {
              type: "POST",
              data: JSON.stringify({base_tree: sha, tree: updates})
            });
          }).then(function(response) {
            return {path: path, mode: "040000", type: "tree", sha: response.sha, parentSha: sha};
          });
        });
  }
}

export default GithubAPI;