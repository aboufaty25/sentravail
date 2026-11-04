// Every existing member follows the SenTravail team (administrators). Runs once;
// members who unfollow later are not re-subscribed.
module.exports.up = async () => {
  const { followTeam } = require('../services/follows');
  await followTeam();
};
