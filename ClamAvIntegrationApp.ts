import {
  IAppAccessors,
  IConfigurationExtend,
  IEnvironmentRead,
  IHttp,
  ILogger,
  IModify,
  IPersistence,
  IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { FileUploadNotAllowedException } from '@rocket.chat/apps-engine/definition/exceptions';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';
import {
  IFileUploadContext,
  IPreFileUpload,
} from '@rocket.chat/apps-engine/definition/uploads';

import { notifyUser } from './src/message/notify';
import { ClamAVService } from './src/clam/ClamAVService';

const CLAMAV_SERVER_HOST = 'clamav_server_host';
const CLAMAV_SERVER_PORT = 'clamav_server_port';
const CLAMAV_TIMEOUT = 'clamav_timeout';
const CLAMAV_MAX_FILE_SIZE = 'clamav_max_file_size';
const CLAMAV_ALLOW_ON_SCAN_FAILURE = 'clamav_allow_on_scan_failure';
const CLAMAV_NOTIFY_ON_CLEAN = 'clamav_notify_on_clean';

export class ClamAvIntegrationApp extends App implements IPreFileUpload {
  constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
    super(info, logger, accessors);
  }

  public async executePreFileUpload(
    context: IFileUploadContext,
    read: IRead,
    http: IHttp,
    persis: IPersistence,
    modify: IModify
  ): Promise<void> {
    const settings = read.getEnvironmentReader().getSettings();

    const host = await settings.getValueById(CLAMAV_SERVER_HOST);
    const port = await settings.getValueById(CLAMAV_SERVER_PORT);
    const timeout = await settings.getValueById(CLAMAV_TIMEOUT);
    const maxFileSize = await settings.getValueById(CLAMAV_MAX_FILE_SIZE);
    const allowOnScanFailure = await settings.getValueById(
      CLAMAV_ALLOW_ON_SCAN_FAILURE
    );
    const notifyOnClean = await settings.getValueById(CLAMAV_NOTIFY_ON_CLEAN);

    if (!host || !port) {
      throw new Error('Missing ClamAv connection configuration');
    }

    // Kontrollera filstorlek innan scanning
    const fileSizeInMB = context.content.length / (1024 * 1024);
    if (maxFileSize && fileSizeInMB > maxFileSize) {
      const fileName = context.file.name ? `"${context.file.name}"` : 'Filen';
      const message = `⚠️ *Fil för stor!*\n*${fileName}* (${fileSizeInMB.toFixed(
        2
      )} MB) överskrider maxgränsen på ${maxFileSize} MB och kan inte skannas.`;

      const room = await read.getRoomReader().getById(context.file.rid);
      const user = room
        ? await read.getUserReader().getById(context.file.userId)
        : null;

      if (room && user) {
        await notifyUser({
          app: this,
          read,
          modify,
          room,
          user,
          text: message,
        });
      }

      throw new FileUploadNotAllowedException(message);
    }

    const clam = new ClamAVService(
      { host, port, timeout: timeout || 10000 },
      this.getLogger()
    );

    // Hämta room och user en gång för alla meddelanden
    const room = await read.getRoomReader().getById(context.file.rid);
    const user = room
      ? await read.getUserReader().getById(context.file.userId)
      : null;

    let result;
    try {
      result = await clam.scanBuffer(context.content, context.file.name);
    } catch (error) {
      // Scanning misslyckades
      this.getLogger().error('ClamAV scan failed:', error);

      const fileName = context.file.name ? `"${context.file.name}"` : 'en fil';
      const errorMessage = error instanceof Error ? error.message : 'Okänt fel';

      if (allowOnScanFailure) {
        // Tillåt uppladdning men varna användaren
        const message = `⚠️ *Varning: Virusskanning ej utförd!*\n*${fileName}* har laddats upp men kunde inte skannas för virus.\nOrsak: ${errorMessage}`;

        if (room && user) {
          await notifyUser({
            app: this,
            read,
            modify,
            room,
            user,
            text: message,
          });
        }

        return;
      } else {
        // Blockera uppladdning
        const message = `⚠️ *Skanning misslyckades!*\nUppladdningen av *${fileName}* har blockerats eftersom virusskanning misslyckades.\nOrsak: ${errorMessage}`;

        if (room && user) {
          await notifyUser({
            app: this,
            read,
            modify,
            room,
            user,
            text: message,
          });
        }

        throw new FileUploadNotAllowedException(message);
      }
    }

    // Hantera null-resultat (timeout eller okänt resultat från ClamAV)
    if (result.isInfected === null) {
      const fileName = context.file.name ? `"${context.file.name}"` : 'en fil';
      const message = `⚠️ *Misstänkt fil!*\nUppladdningen av *${fileName}* har blockerats eftersom scanningen gav oklart resultat (möjlig timeout eller ClamAV-fel).\nFilen behandlas som potentiellt farlig.`;

      if (room && user) {
        await notifyUser({
          app: this,
          read,
          modify,
          room,
          user,
          text: message,
        });
      }

      throw new FileUploadNotAllowedException(message);
    }

    if (result.isInfected) {
      const fileName = context.file.name ? `"${context.file.name}"` : 'en fil';
      const virusList =
        result.viruses
          .filter(Boolean)
          .map((v) => `*${v}*`)
          .join(', ') || 'ett oidentifierat hot';

      const message = `❌ *Virus upptäckt!*\nUppladdningen av *${fileName}* har blockerats eftersom den innehåller ${virusList}.`;

      if (room && user) {
        await notifyUser({
          app: this,
          read,
          modify,
          room,
          user,
          text: message,
        });
      }

      throw new FileUploadNotAllowedException(message);
    }

    // Filen är ren - skicka bekräftelsemeddelande om konfigurerat
    if (notifyOnClean && room && user) {
      const fileName = context.file.name ? `"${context.file.name}"` : 'Filen';
      const message = `✅ ${fileName} har skannats och är ren.`;

      await notifyUser({
        app: this,
        read,
        modify,
        room,
        user,
        text: message,
      });
    }
  }

  protected async extendConfiguration(
    configuration: IConfigurationExtend,
    environmentRead: IEnvironmentRead
  ): Promise<void> {
    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_SERVER_HOST,
      type: SettingType.STRING,
      packageValue: '',
      i18nLabel: 'clamav_server_host_label',
      i18nDescription: 'clamav_server_host_description',
      required: true,
    });

    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_SERVER_PORT,
      type: SettingType.NUMBER,
      packageValue: 3310,
      i18nLabel: 'clamav_server_port_label',
      i18nDescription: 'clamav_server_port_description',
      required: true,
    });

    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_TIMEOUT,
      type: SettingType.NUMBER,
      packageValue: 10000,
      i18nLabel: 'clamav_timeout_label',
      i18nDescription: 'clamav_timeout_description',
      required: false,
    });

    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_MAX_FILE_SIZE,
      type: SettingType.NUMBER,
      packageValue: 100,
      i18nLabel: 'clamav_max_file_size_label',
      i18nDescription: 'clamav_max_file_size_description',
      required: false,
    });

    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_ALLOW_ON_SCAN_FAILURE,
      type: SettingType.BOOLEAN,
      packageValue: false,
      i18nLabel: 'clamav_allow_on_scan_failure_label',
      i18nDescription: 'clamav_allow_on_scan_failure_description',
      required: false,
    });

    configuration.settings.provideSetting({
      public: true,
      id: CLAMAV_NOTIFY_ON_CLEAN,
      type: SettingType.BOOLEAN,
      packageValue: false,
      i18nLabel: 'clamav_notify_on_clean_label',
      i18nDescription: 'clamav_notify_on_clean_description',
      required: false,
    });
  }
}
