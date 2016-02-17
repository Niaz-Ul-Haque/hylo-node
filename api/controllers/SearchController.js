var findCommunityIds = Promise.method(req => {
  if (req.param('communityId')) {
    return [req.param('communityId')]
  } else if (req.param('type') === 'communities' && req.param('moderated')) {
    if (Admin.isSignedIn(req)) {
      return Community.fetchAll()
      .then(cs => cs.pluck('id'))
    } else {
      return Membership.activeCommunityIds(req.session.userId, true)
    }
  } else {
    return Promise.join(
      Network.activeCommunityIds(req.session.userId),
      Membership.activeCommunityIds(req.session.userId)
    ).then(ids => _(ids).flatten().uniq().value())
  }
})

module.exports = {
  show: function (req, res) {
    var term = req.param('q').trim()
    var resultTypes = req.param('include')
    var limit = req.param('limit') || 10
    var offset = req.param('offset') || 0

    return findCommunityIds(req)
    .then(function (communityIds) {
      return Promise.join(
        _.includes(resultTypes, 'posts') && Search.forPosts({
          term: term,
          limit: limit,
          offset: offset,
          communities: communityIds,
          sort: 'post.created_at'
        }).fetchAll({withRelated: PostPresenter.relations(req.session.userId)}),
        _.includes(resultTypes, 'people') && Search.forUsers({
          term: term,
          limit: limit,
          offset: offset,
          communities: communityIds
        }).fetchAll({withRelated: ['skills', 'organizations']})
      )
    })
    .spread(function (posts, people) {
      res.ok({
        posts_total: posts && (posts.length > 0 ? Number(posts.first().get('total')) : 0),
        posts: posts && posts.map(PostPresenter.present),
        people_total: people && (people.length > 0 ? Number(people.first().get('total')) : 0),
        people: people && people.map(function (user) {
          return _.chain(user.attributes)
            .pick(UserPresenter.shortAttributes)
            .extend({
              skills: Skill.simpleList(user.relations.skills),
              organizations: Organization.simpleList(user.relations.organizations)
            }).value()
        })
      })
    })
    .catch(res.serverError)
  },

  autocomplete: function (req, res) {
    var term = req.param('q').trim()
    var resultType = req.param('type')
    var sort, method, columns

    switch (resultType) {
      case 'posts':
        method = Search.forPosts
        sort = 'post.created_at'
        break
      case 'skills':
        method = Search.forSkills
        columns = ['skill_name']
        break
      case 'organizations':
        method = Search.forOrganizations
        columns = ['org_name']
        break
      case 'communities':
        method = Search.forCommunities
        columns = ['id', 'name', 'avatar_url']
        break
      default:
        method = Search.forUsers
    }

    return (() => {
      if (!_.includes(['skills', 'organizations'], resultType)) {
        return findCommunityIds(req)
        .then(communityIds => ({
          communities: communityIds,
          project: req.param('projectId')
        }))
      }

      return Promise.resolve({})
    })()
    .then(filters => method(_.extend(filters, {
      autocomplete: term,
      limit: req.param('limit') || 5,
      sort: sort
    })).fetchAll({columns: columns}))
    .then(rows => {
      var present
      switch (resultType) {
        case 'posts':
          present = row => row.pick('id', 'name')
          break
        case 'skills':
          present = row => ({name: row.get('skill_name')})
          break
        case 'organizations':
          present = row => ({name: row.get('org_name')})
          break
        default:
          present = row => row.pick('id', 'name', 'avatar_url')
      }
      res.ok(rows.map(present))
    })
    .catch(res.serverError)
  }

}
