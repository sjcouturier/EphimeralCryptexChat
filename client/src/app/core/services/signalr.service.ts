import { Injectable, inject, signal } from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { Conversation } from '../models/conversation.model';
import { Message, SendMessageDto } from '../models/message.model';
import { connectionState as connectionStateGlobal } from '../state/app.state';
import { AuthService } from './auth.service';

export interface MessageReadEvent {
  messageId: number;
  conversationId: number;
}

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthService);
  private connection?: HubConnection;
  private startPromise?: Promise<void>;

  readonly connectionState = signal<HubConnectionState>(HubConnectionState.Disconnected);

  readonly onReceiveMessage$ = new Subject<Message>();
  readonly onMessageRead$ = new Subject<MessageReadEvent>();
  readonly onConversationUpdated$ = new Subject<Conversation>();
  readonly onUserOnline$ = new Subject<number>();
  readonly onUserOffline$ = new Subject<number>();

  /** Builds (once) and starts the hub connection, wiring up all event listeners. */
  async startConnection(): Promise<void> {
    if (this.connection && this.connection.state === HubConnectionState.Connected) {
      console.log('[SignalR] Already connected');
      return;
    }
    if (this.startPromise) {
      console.log('[SignalR] Connection in progress, waiting...');
      return this.startPromise;
    }

    console.log('[SignalR] Starting connection to', APP_CONFIG.hubUrl);
    this.connection = new HubConnectionBuilder()
      .withUrl(APP_CONFIG.hubUrl, {
        accessTokenFactory: () => this.auth.getToken() ?? '',
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.registerHandlers(this.connection);

    this.connection.onreconnecting(() => {
      console.log('[SignalR] Reconnecting...');
      this.syncState();
    });
    this.connection.onreconnected(() => {
      console.log('[SignalR] Reconnected');
      this.syncState();
    });
    this.connection.onclose(() => {
      console.log('[SignalR] Connection closed');
      this.syncState();
    });

    this.startPromise = this.connection
      .start()
      .then(() => {
        console.log('[SignalR] Connected successfully');
        this.syncState();
      })
      .catch((err) => {
        console.error('[SignalR] Connection failed:', err);
        this.syncState();
        this.startPromise = undefined;
        throw err;
      });

    return this.startPromise;
  }

  async stopConnection(): Promise<void> {
    await this.connection?.stop();
    this.startPromise = undefined;
    this.syncState();
  }

  async joinConversation(conversationId: number): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke('JoinConversation', conversationId);
  }

  async leaveConversation(conversationId: number): Promise<void> {
    if (this.connection?.state === HubConnectionState.Connected) {
      await this.connection.invoke('LeaveConversation', conversationId);
    }
  }

  async sendMessage(dto: SendMessageDto): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke('SendMessage', dto);
  }

  async acknowledgeRead(messageId: number, conversationId: number): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke('AcknowledgeRead', messageId, conversationId);
  }

  async acknowledgeDelivery(messageId: number, conversationId: number): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke('AcknowledgeDelivery', messageId, conversationId);
  }

  private registerHandlers(connection: HubConnection): void {
    connection.on('ReceiveMessage', (message: Message) => {
      console.log('[SignalR] ReceiveMessage:', message);
      this.onReceiveMessage$.next(message);
    });
    connection.on('MessageRead', (messageId: number, conversationId: number) => {
      console.log('[SignalR] MessageRead:', messageId, conversationId);
      this.onMessageRead$.next({ messageId, conversationId });
    });
    connection.on('ConversationUpdated', (conversation: Conversation) => {
      console.log('[SignalR] ConversationUpdated:', conversation);
      this.onConversationUpdated$.next(conversation);
    });
    connection.on('UserOnline', (userId: number) => {
      console.log('[SignalR] UserOnline:', userId);
      this.onUserOnline$.next(userId);
    });
    connection.on('UserOffline', (userId: number) => {
      console.log('[SignalR] UserOffline:', userId);
      this.onUserOffline$.next(userId);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connection || this.connection.state === HubConnectionState.Disconnected) {
      await this.startConnection();
    }
  }

  private syncState(): void {
    const state = this.connection?.state ?? HubConnectionState.Disconnected;
    this.connectionState.set(state);
    connectionStateGlobal.set(state);
  }
}
