
export async function uploadToDrive(accessToken: string, filename: string, data: any) {
  const boundary = 'foo_bar_baz';
  const delimiter = `\n--${boundary}\n`;
  const closeDelimiter = `\n--${boundary}--`;

  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\n\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\n\n' +
    JSON.stringify(data, null, 2) +
    closeDelimiter;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to upload to Google Drive');
  }

  return await response.json();
}

export async function findOrCreateFolder(accessToken: string, folderName: string) {
  // Search for folder
  const query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const searchData = await searchResponse.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  const createData = await createResponse.json();
  return createData.id;
}

export async function uploadToFolder(accessToken: string, folderId: string, filename: string, data: any) {
    const boundary = 'foo_bar_baz';
    const delimiter = `\n--${boundary}\n`;
    const closeDelimiter = `\n--${boundary}--`;
  
    const metadata = {
      name: filename,
      mimeType: 'application/json',
      parents: [folderId]
    };
  
    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\n\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\n\n' +
      JSON.stringify(data, null, 2) +
      closeDelimiter;
  
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );
  
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to upload to Google Drive');
    }
  
    return await response.json();
}
