const ora = require('ora');
const constants = require('../shared/constants');
const error = require('./error');

/**
 * Duplicate an entry recursively
 *
 * @param {string} entryId - Entry ID
 * @param {string} environment - Source Environment
 * @param {boolean} publish - Publish Entry after duplicate or not,
 * the created entry's status is the same with the original entry,
 * set false to force the created entry to be draft although the original entry is published.
 * @param {Array} exclude - Array of Entry IDs that will be excluded
 * @param {boolean} isSingleLevel - If true, then it's no need to clone sub entries, just link
 * @param {string} targetEnvironment - Target Environment
 * @param {string} prefix - Prefix of the created entry name
 * @param {string} suffix - Suffix of the created entry name
 * @param {RegExp} regex - Regex pattern of the created entry name
 * @param {string} replaceStr - String replace for the created entry name
 */
const duplicateEntry = async (
  entryId, environment, publish, exclude, isSingleLevel, targetEnvironment,
  prefix, suffix, regex, replaceStr, targetContentTypes, duplicatedEntries,
  entryType=constants.ENTRY_TYPE) => {
  const spinner = ora().start();

  if (!exclude.includes(entryId)) {
    let entry;
    // get the entry by id
    if (entryType === constants.ENTRY_TYPE) {
     entry = await environment.getEntry(entryId).catch(err => error(err.message, true));
    }
    else {
     entry = await environment.getAsset(entryId).catch(err => error(err.message, true));
    }

    // clone entry fields value
    const newEntryFields = {
      ...entry.fields,
    };

    /* eslint-disable no-await-in-loop */
    for (const field of Object.keys(newEntryFields)) {
      // apply the new name for the new entry (if needed)
      if (field === constants.FIELD_NAME ||
          field === constants.FIELD_TITLE ||
          field === constants.FIELD_SLUG) {
        for (const localeKey of Object.keys(newEntryFields[field])) {
          let createdName = newEntryFields[field][localeKey];

          if (regex && replaceStr) {
            createdName = createdName.replace(regex, replaceStr);
          }

          if (field === constants.FIELD_SLUG) createdName = prefix.trim() + createdName + suffix.trim();
          else createdName = prefix + createdName + suffix;

          newEntryFields[field][localeKey] = createdName;
        }
      } else {
        // iterates through other fields,
        // if the field contains a link to another entry, then duplicate
        const fieldContent = entry.fields[field];

        for (const fieldContentKey of Object.keys(fieldContent)) {
          const fieldContentValue = fieldContent[fieldContentKey];

          if (!isSingleLevel && Array.isArray(fieldContentValue)) {
            for (const [contentIndex, content] of fieldContentValue.entries()) {
              if (content.sys.type === constants.LINK_TYPE
                  && !exclude.includes(content.sys.id)) {
                if (duplicatedEntries[content.sys.id]) {
                  spinner.info(`NOT duplicating sub entry #${content.sys.id}`);
                  fieldContentValue[contentIndex].sys.id = duplicatedEntries[content.sys.id];
                  }
                else {
                  spinner.info(`Duplicating sub entry #${content.sys.id}`);

                  const duplicatedEntry = await duplicateEntry(
                    content.sys.id, environment, publish, exclude, isSingleLevel, targetEnvironment,
                    prefix, suffix, regex, replaceStr, targetContentTypes, duplicatedEntries, content.sys.linkType
                  );
                  fieldContentValue[contentIndex].sys.id = duplicatedEntry.sys.id;


                }
              }
            }
          }

          newEntryFields[field][fieldContentKey] = fieldContentValue;
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    spinner.info(`Duplicating entry #${entry.sys.id}`);
    // create new entry
    let newEntry;
    if (entry.sys.type === constants.ENTRY_TYPE) {
      newEntry = targetEnvironment.createEntry(entry.sys.contentType.sys.id, {
        fields: newEntryFields,
      }).then((e) => {
        spinner.stop();
        duplicatedEntries[entry.sys.id] = e.sys.id;
        return e;
      }).catch((err) => {
        spinner.stop();
        error(err.message, true);
      });
    }
    else {
      for (const region of Object.keys(newEntryFields.file)) {
        if (newEntryFields.file[region].url) {
          newEntryFields.file[region]['upload'] = "https:" + newEntryFields.file[region].url;
          delete newEntryFields.file[region].url;
        }
        delete newEntryFields.file[region].details;
      }
      console.log(newEntryFields)
      newEntry = targetEnvironment.createAsset({
        fields: newEntryFields,
      }) .then((asset) => {
        console.log("asset", asset);
        console.log("type", typeof asset);
        console.log("properties", Object.getOwnPropertyNames(asset))
        return asset.processForAllLocales();
      }
      ) .then((e) => {
        console.log(e.fields.file);
        spinner.stop();
        duplicatedEntries[entry.sys.id] = e.sys.id;
        return e;
      }).catch((err) => {
        spinner.stop();
        error(err.message, true);
      });
    }


    // check if the new entry need to publish or not
    if (publish ) {
      if (entry.isPublished()) {
        let canPublish;
        if (entry.sys.type === constants.ENTRY_TYPE){
        // if the entry's content type has a required asset field,
        // then the entry will be draft.
        const contentType = targetContentTypes.items.find(
          item => item.sys.id === entry.sys.contentType.sys.id,
        );

        canPublish = true;
        for (const f of contentType.fields) {
          if (f.linkType === constants.ASSET_TYPE && f.required) {
            const entryFieldObject = entry.fields[f.id];

            /* eslint-disable no-await-in-loop */
            for (const entryFieldKey of Object.keys(entryFieldObject)) {
              const entryFieldValue = entryFieldObject[entryFieldKey];

              /* eslint-disable no-loop-func */
              await targetEnvironment.getAsset(entryFieldValue.sys.id).catch(() => {
                canPublish = false;
              });
              /* eslint-enable no-loop-func */
            }
            /* eslint-enable no-await-in-loop */
          }
        }

        }
        else canPublish = true;

        if (canPublish) {
          return newEntry.then(e => e.publish()).catch(err => error(err.message, true));
        }
      }
    }


  }

    spinner.info("returning null");
  return null;
};

module.exports = duplicateEntry;
