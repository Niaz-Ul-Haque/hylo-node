module.exports = bookshelf.Model.extend({
  tableName: 'community',

  creator:       () => this.belongsTo(User, 'created_by_id'),
  inactiveUsers: () => this.belongsToMany(User, 'users_community', 'community_id', 'user_id')
                       .query({where: {'users_community.active': false}}),
  invitations:   () => this.hasMany(Invitation),
  leader:        () => this.belongsTo(User, 'leader_id'),
  memberships:   () => this.hasMany(Membership).query({where: {'users_community.active': true}}),
  moderators:    () => this.belongsToMany(User, 'users_community', 'community_id', 'user_id')
                       .query({where: {role: Membership.MODERATOR_ROLE}}),
  network:       () => this.belongsTo(Network),
  users:         () => this.belongsToMany(User, 'users_community', 'community_id', 'user_id')
                       .query({where: {'users_community.active': true}}),

  posts: function() {
    return this.belongsToMany(Post).through(PostMembership)
    .query({where: {'post.active': true}});
  },

  comments: function() {
    // FIXME get this to use the model relation API
    // instead of the Collection API so that the use
    // of fetch vs. fetchAll isn't confusing.
    // as it is now, it uses "fetchAll" when all the
    // other relations use "fetch"
    var communityId = this.id;
    return Comment.query(function(qb) {
      qb.where({
        'post_community.community_id': communityId,
        'comment.active': true
      }).leftJoin('post_community', () =>
        this.on('post_community.post_id', 'comment.post_id'));
    });
  },

  isNewContentPublic: function() {
    return this.get('default_public_content') && this.get('allow_public_content');
  }

}, {

  find: function(id_or_slug, options) {
    if (isNaN(Number(id_or_slug))) {
      return Community.where({slug: id_or_slug}).fetch(options);
    }
    return Community.where({id: id_or_slug}).fetch(options);
  },

  canInvite: function(userId, communityId) {
    return Community.find(communityId).then(function(community) {
      if (community.get('settings').all_can_invite) return true;
      return Membership.hasModeratorRole(userId, communityId);
    });
  },

  copyAssets: function(opts) {
    return Community.find(opts.communityId).then(c => Promise.join(
      AssetManagement.copyAsset(c, 'community', 'avatar_url'),
      AssetManagement.copyAsset(c, 'community', 'banner_url')
    ));
  },

  notifyAboutCreate: function(opts) {
    return Community.find(opts.communityId, {withRelated: ['creator']}).then(c => {
      var creator = c.relations.creator,
        recipient = process.env.ASANA_NEW_COMMUNITIES_EMAIL;
      Email.sendRawEmail(recipient, {
        subject: c.get('name'),
        body: format(
          '%s<br/>created by %s<br/>%s<br/>%s',
          Frontend.Route.community(c),
          creator.get('name'),
          creator.get('email'),
          Frontend.Route.profile(creator))
      }, {
        sender: {
          name: 'Hylobot',
          address: 'edward@hylo.com'
        }
      });
    });
  }

});
