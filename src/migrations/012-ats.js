// ATS: applications received and managed directly on SenTravail, with recruitment stages.
async function setEnum(qi, table, column, values, definition) {
  const cols = await qi.describeTable(table);
  if (!cols[column]) return;
  const type = String(cols[column].type);
  if (values.every((v) => type.includes(`'${v}'`))) return;
  await qi.changeColumn(table, column, definition);
}

module.exports.up = async (qi, DataTypes) => {
  const { addColumnIfMissing } = require('../config/migrate');
  await setEnum(qi, 'jobs', 'applyMode', ['email', 'link', 'platform'],
    { type: DataTypes.ENUM('email', 'link', 'platform'), allowNull: false, defaultValue: 'email' });
  const STATUSES = ['opened_mail', 'confirmed_sent', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];
  await setEnum(qi, 'applications', 'status', STATUSES,
    { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'opened_mail' });
  await setEnum(qi, 'applications', 'sentVia', ['mailto', 'server', 'platform'],
    { type: DataTypes.ENUM('mailto', 'server', 'platform'), allowNull: true });
  await addColumnIfMissing(qi, 'applications', 'recruiterNote', { type: DataTypes.TEXT, allowNull: true });
  await addColumnIfMissing(qi, 'applications', 'interviewAt', { type: DataTypes.DATE, allowNull: true });
  await addColumnIfMissing(qi, 'applications', 'interviewPlace', { type: DataTypes.STRING(200), allowNull: true });
  await addColumnIfMissing(qi, 'applications', 'stageAt', { type: DataTypes.DATE, allowNull: true });
};
