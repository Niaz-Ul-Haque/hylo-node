module.exports = bookshelf.Model.extend({
  tableName: 'project_roles',
  project: function () {
    return this.belongsTo(Post)
  }
}, {
  find: function (id, options) {
    return ProjectRole.where({id}).fetch(options)
  }
})
