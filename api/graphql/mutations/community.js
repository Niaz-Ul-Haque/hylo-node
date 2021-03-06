import CommunityService from "../../services/CommunityService";
import convertGraphqlData from "./convertGraphqlData";
import underlyingDeleteCommunityTopic from "../../models/community/deleteCommunityTopic";

export async function updateCommunity(userId, communityId, changes) {
	const community = await getModeratedCommunity(userId, communityId);
	return community.update(convertGraphqlData(changes));
}

export async function addModerator(userId, personId, communityId) {
	const community = await getModeratedCommunity(userId, communityId);
	await GroupMembership.setModeratorRole(personId, community);
	return community;
}

export async function removeModerator(
	userId,
	personId,
	communityId,
	isRemoveFromCommunity
) {
	const community = await getModeratedCommunity(userId, communityId);
	if (isRemoveFromCommunity) {
		await GroupMembership.removeModeratorRole(personId, community);
		await CommunityService.removeMember(personId, communityId);
	} else {
		await GroupMembership.removeModeratorRole(personId, community);
	}

	return community;
}

/**
 * As a moderator, removes member from a community.
 */
export async function removeMember(
	loggedInUserId,
	userIdToRemove,
	communityId
) {
	const community = await getModeratedCommunity(loggedInUserId, communityId);
	await CommunityService.removeMember(userIdToRemove, communityId);
	return community;
}

export async function regenerateAccessCode(userId, communityId) {
	const community = await getModeratedCommunity(userId, communityId);
	const code = await Community.getNewAccessCode();
	return community.save({ beta_access_code: code }, { patch: true }); // eslint-disable-line camelcase
}

export async function createCommunity(userId, data) {
	if (data.networkId) {
		const canModerate = await NetworkMembership.hasModeratorRole(
			userId,
			data.networkId
		);
		if (!canModerate) {
			throw new Error(
				"You don't have permission to add a community to this network"
			);
		}
	}
	return Community.create(userId, convertGraphqlData(data));
}

async function getModeratedCommunity(userId, communityId) {
	const community = await Community.find(communityId);
	if (!community) {
		throw new Error("Community not found");
	}

	const isModerator = await GroupMembership.hasModeratorRole(userId, community);
	if (!isModerator) {
		throw new Error("You don't have permission to moderate this community");
	}

	return community;
}

export async function deleteCommunityTopic(userId, communityTopicId) {
	const communityTopic = await CommunityTag.where({
		id: communityTopicId,
	}).fetch();

	await getModeratedCommunity(userId, communityTopic.get("community_id"));

	await underlyingDeleteCommunityTopic(communityTopic);
	return { success: true };
}

export async function deleteCommunity(userId, communityId) {
	await getModeratedCommunity(userId, communityId);

	await Community.deactivate(communityId);
	return { success: true };
}
