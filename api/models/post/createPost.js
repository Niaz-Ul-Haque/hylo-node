import { flatten, merge, pick, uniq } from "lodash";
import setupPostAttrs from "./setupPostAttrs";
import updateChildren from "./updateChildren";
import { updateNetworkMemberships } from "./util";
import { communityRoom, pushToSockets } from "../../services/Websockets";

export default function createPost(userId, params) {
  return setupPostAttrs(userId, merge(Post.newPostAttrs(), params)).then(
    (attrs) =>
      bookshelf
        .transaction((transacting) =>
          Post.create(attrs, { transacting }).tap((post) =>
            afterCreatingPost(
              post,
              merge(
                pick(
                  params,
                  "community_ids",
                  "imageUrl",
                  "videoUrl",
                  "docs",
                  "topicNames",
                  "memberIds",
                  "eventInviteeIds",
                  "imageUrls",
                  "fileUrls",
                  "announcement",
                  "location",
                  "location_id"
                ),
                { children: params.requests, transacting }
              )
            )
          )
        )
        .then(function (inserts) {
          return inserts;
        })
        .catch(function (error) {
          throw error;
        })
  );
}

export function afterCreatingPost(post, opts) {
  const userId = post.get("user_id");
  const mentioned = RichText.getUserMentions(post.get("description"));
  const followerIds = uniq(mentioned.concat(userId));
  const trx = opts.transacting;
  const trxOpts = pick(opts, "transacting");

  return Promise.all(
    flatten([
      opts.community_ids &&
        post.communities().attach(uniq(opts.community_ids), trxOpts),

      // Add mentioned users and creator as followers
      post.addFollowers(followerIds, trxOpts),

      // Add creator to RSVPs
      post.get("type") === "event" &&
        EventInvitation.create(
          {
            userId,
            inviterId: userId,
            eventId: post.id,
            response: EventInvitation.RESPONSE.YES,
          },
          trxOpts
        ),

      // Add media, if any
      // redux version
      opts.imageUrl &&
        Media.createForSubject(
          {
            subjectType: "post",
            subjectId: post.id,
            type: "image",
            url: opts.imageUrl,
          },
          trx
        ),

      // evo version
      opts.imageUrls &&
        Promise.map(opts.imageUrls, (url, i) =>
          Media.createForSubject(
            {
              subjectType: "post",
              subjectId: post.id,
              type: "image",
              url,
              position: i,
            },
            trx
          )
        ),

      // evo version
      opts.fileUrls &&
        Promise.map(opts.fileUrls, (url, i) =>
          Media.createForSubject(
            {
              subjectType: "post",
              subjectId: post.id,
              type: "file",
              url,
              position: i,
            },
            trx
          )
        ),

      opts.children && updateChildren(post, opts.children, trx),

      // google doc / video not currently used in evo
      opts.videoUrl &&
        Media.createForSubject(
          {
            subjectType: "post",
            subjectId: post.id,
            type: "video",
            url: opts.videoUrl,
          },
          trx
        ),

      opts.docs &&
        Promise.map(opts.docs, (doc) => Media.createDoc(post.id, doc, trx)),
    ])
  )
    .then(() => post.updateProjectMembers(opts.memberIds || [], trxOpts))
    .then(() =>
      post.updateEventInvitees(opts.eventInviteeIds || [], userId, trxOpts)
    )
    .then(() => Tag.updateForPost(post, opts.topicNames, userId, trx))
    .then(() => updateTagsAndCommunities(post, trx))
    .then(() => updateNetworkMemberships(post, trx))
    .then(() =>
      Queue.classMethod("Post", "createActivities", { postId: post.id })
    )
    .then(() => Queue.classMethod("Post", "notifySlack", { postId: post.id }));
}

async function updateTagsAndCommunities(post, trx) {
  await post.load(["communities", "linkPreview", "networks", "tags", "user"], {
    transacting: trx,
  });

  const { tags, communities } = post.relations;

  // NOTE: the payload object is released to many users, so it cannot be
  // subject to the usual permissions checks (which communities/networks
  // the user is allowed to view, etc). This means we either omit the
  // information, or (as below) we only post community data for the socket
  // room it's being pushed to.
  // TODO: eventually we will need to push to socket rooms for networks.
  const payload = post.getNewPostSocketPayload();
  const notifySockets = payload.communities.map((c) => {
    pushToSockets(
      communityRoom(c.id),
      "newPost",
      Object.assign({}, payload, { communities: [c] })
    );
  });

  const updateCommunityTags = CommunityTag.query((q) => {
    q.whereIn("tag_id", tags.map("id"));
  })
    .query()
    .update({ updated_at: new Date() })
    .transacting(trx);

  return Promise.all([
    notifySockets,
    updateCommunityTags,

    TagFollow.query((q) => {
      q.whereIn("tag_id", tags.map("id"));
      q.whereIn("community_id", communities.map("id"));
      q.whereNot("user_id", post.get("user_id"));
    })
      .query()
      .increment("new_post_count")
      .transacting(trx),

    GroupMembership.query((q) => {
      const groupIds = Group.query((q2) => {
        q2.whereIn("group_data_id", communities.map("id"));
        q2.where("group_data_type", Group.DataType.COMMUNITY);
      })
        .query()
        .pluck("id");

      q.whereIn("group_id", groupIds);
      q.whereNot("group_memberships.user_id", post.get("user_id"));
      q.where("group_memberships.active", true);
    })
      .query()
      .increment("new_post_count")
      .transacting(trx),
  ]);
}
