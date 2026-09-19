/**
 * 📁 Google Drive Cloud Storage Integration
 * Direct photo upload and permanent hosting via Google Drive REST API v3
 */

const FOLDER_NAME = 'Smart Hisab Production Photos';
let cachedFolderId = null;

/**
 * Convert Base64 data URL to Blob
 */
export function base64ToBlob(dataUrl) {
  if (!dataUrl) return null;
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

/**
 * Ensure dedicated folder exists in user's Google Drive
 */
export async function getOrCreateDriveFolder(accessToken) {
  if (cachedFolderId) return cachedFolderId;

  try {
    // Search for existing folder
    const query = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        cachedFolderId = data.files[0].id;
        return cachedFolderId;
      }
    }

    // Create new folder if not found
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if (createRes.ok) {
      const folderData = await createRes.json();
      cachedFolderId = folderData.id;
      return cachedFolderId;
    }
  } catch (err) {
    console.warn('Failed to ensure Drive folder, uploading to root:', err);
  }

  return null;
}

/**
 * Upload Image directly to Google Drive via multipart upload
 * @param {string|Blob} imageInput - Base64 Data URL or Blob
 * @param {string} fileName - Destination file name
 * @param {string} accessToken - Google OAuth access token
 * @param {object} meta - Extra metadata (e.g. record ID)
 */
export async function uploadImageToDrive(imageInput, fileName, accessToken, meta = {}) {
  if (!accessToken) {
    throw new Error('Google OAuth access token missing. Please sign in with Google first.');
  }

  let blob = null;
  if (typeof imageInput === 'string') {
    blob = base64ToBlob(imageInput);
  } else if (imageInput instanceof Blob) {
    blob = imageInput;
  }

  if (!blob) {
    throw new Error('Invalid image data provided for Google Drive upload.');
  }

  const folderId = await getOrCreateDriveFolder(accessToken);
  const cleanFileName = fileName || `SmartHisab_${Date.now()}.jpg`;

  // Multipart request boundary
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: cleanFileName,
    mimeType: blob.type || 'image/jpeg',
    description: `Smart Hisab Production Photo [Record: ${meta.recordId || '-'}]`
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const metadataString = JSON.stringify(metadata);

  // Read blob as ArrayBuffer to construct multipart payload
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const encoder = new TextEncoder();
  const metaHeader = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadataString}\r\n${delimiter}Content-Type: ${metadata.mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
  const metaBytes = encoder.encode(metaHeader);
  const closeBytes = encoder.encode(closeDelimiter);

  const combinedPayload = new Uint8Array(metaBytes.length + bytes.length + closeBytes.length);
  combinedPayload.set(metaBytes, 0);
  combinedPayload.set(bytes, metaBytes.length);
  combinedPayload.set(closeBytes, metaBytes.length + bytes.length);

  // Upload to Drive REST API v3
  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: combinedPayload
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Google Drive Upload Failed (${uploadRes.status}): ${errorText}`);
  }

  const fileData = await uploadRes.json();
  const fileId = fileData.id;

  // Make the file publicly viewable so direct preview works seamlessly across all devices
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
        allowFileDiscovery: false
      })
    });
  } catch (permErr) {
    console.warn('Could not set public view permission on Drive file:', permErr);
  }

  // Universal high-reliability thumbnail endpoint with size parameter
  const directImageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=s1000`;
  const webViewLink = fileData.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

  return {
    success: true,
    fileId,
    directImageUrl,
    thumbnailUrl: directImageUrl,
    lh3Url: `https://lh3.googleusercontent.com/d/${fileId}`,
    webViewLink,
    name: fileData.name
  };
}

/**
 * Fetch image directly from Google Drive API with Authorization Bearer token
 * Essential fallback if hotlinking is blocked by browser/iframe cookies
 */
export async function fetchDriveImageBlob(fileId, accessToken) {
  if (!fileId || !accessToken) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (res.ok) {
      return await res.blob();
    }
  } catch (e) {
    console.warn('fetchDriveImageBlob failed:', e);
  }
  return null;
}

/**
 * Delete a Drive file with Mandatory User Confirmation per SKILL.md
 */
export async function deleteDriveFileWithConfirmation(fileId, fileName, accessToken) {
  if (!fileId || !accessToken) return false;

  const confirmed = window.confirm(
    `আপনি কি নিশ্চিত যে Google Drive থেকে "${fileName || 'এই ছবিটি'}" স্থায়ীভাবে মুছে ফেলতে চান? এটি আর ফিরিয়ে আনা যাবে না।`
  );

  if (!confirmed) return false;

  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to delete file from Google Drive:', err);
    return false;
  }
}

/**
 * Get web URL to view the dedicated folder on Google Drive
 */
export function getDriveFolderUrl() {
  if (cachedFolderId) {
    return `https://drive.google.com/drive/folders/${cachedFolderId}`;
  }
  return `https://drive.google.com/drive/search?q=title:'${encodeURIComponent(FOLDER_NAME)}'`;
}
