const { Octokit } = require('@octokit/rest');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;
const BRANCH = process.env.GITHUB_BRANCH || 'main';

const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

async function updateFileOnGitHub(filePath, content, commitMessage, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📤 Updating ${filePath} on GitHub (attempt ${attempt})...`);
      
      // ✅ ALWAYS fetch fresh SHA before updating
      let sha = null;
      try {
        const { data } = await octokit.repos.getContent({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          path: filePath,
          ref: BRANCH
        });
        sha = data.sha;
        console.log(`   Found existing file with SHA: ${sha.substring(0, 7)}...`);
      } catch (error) {
        if (error.status === 404) {
          console.log(`   File doesn't exist yet, will create new file`);
          sha = null;
        } else {
          throw error;
        }
      }

      // Create or update the file
      const response = await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        sha: sha,
        branch: BRANCH
      });

      console.log(`✅ Successfully updated ${filePath} on GitHub`);
      console.log(`   Commit: ${response.data.commit.sha.substring(0, 7)}`);
      return true;
      
    } catch (error) {
      // ✅ If SHA mismatch (409 conflict), retry with fresh SHA
      if (error.status === 409 && attempt < retries) {
        console.log(`⚠️ SHA mismatch, retrying (attempt ${attempt + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        continue;
      }
      
      console.error(`❌ Error updating ${filePath} on GitHub:`, error.message);
      throw error;
    }
  }
}

async function getFileFromGitHub(filePath) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filePath,
      ref: BRANCH
    });
    
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  updateFileOnGitHub,
  getFileFromGitHub
};