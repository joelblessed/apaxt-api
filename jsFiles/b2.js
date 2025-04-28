// b2.js
const B2 = require('backblaze-b2');
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

let uploadUrl = null;
let uploadAuthToken = null;

async function authorize() {
  await b2.authorize();
  const response = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });
  uploadUrl = response.data.uploadUrl;
  uploadAuthToken = response.data.authorizationToken;
}



function getUploadDetails() {
  return { uploadUrl, uploadAuthToken };
}
module.exports = { b2, authorize, getUploadDetails };