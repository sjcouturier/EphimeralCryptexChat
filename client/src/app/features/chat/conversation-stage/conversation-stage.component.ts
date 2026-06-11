import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { filter } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { AmbientBackgroundComponent } from '../../../shared/ambient-background/ambient-background.component';
import { MessageBubbleComponent } from '../message-bubble/message-bubble.component';
import { ComposePanelComponent, ComposePayload } from '../compose-panel/compose-panel.component';
import { Conversation } from '../../../core/models/conversation.model';
import { Message, MessageStatus } from '../../../core/models/message.model';
import { User } from '../../../core/models/user.model';
import { ChatApiService } from '../../../core/services/chat-api.service';
import { SignalrService } from '../../../core/services/signalr.service';
import { CryptoService } from '../../../core/services/crypto.service';
import { AudioService } from '../../../core/services/audio.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  activeConversationId,
  conversations,
  currentUser,
  upsertConversation,
} from '../../../core/state/app.state';

type StageMode = 'incoming' | 'outgoing' | 'compose' | 'awaiting' | 'loading';

@Component({
  selector: 'app-conversation-stage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AmbientBackgroundComponent, MessageBubbleComponent, ComposePanelComponent],
  templateUrl: './conversation-stage.component.html',
  styleUrl: './conversation-stage.component.scss',
})
export class ConversationStageComponent implements OnInit, OnDestroy {
  @ViewChild(AmbientBackgroundComponent) ambient?: AmbientBackgroundComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ChatApiService);
  private readonly signalr = inject(SignalrService);
  private readonly crypto = inject(CryptoService);
  private readonly audio = inject(AudioService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly conversationId = signal<number>(0);
  readonly displayMessage = signal<Message | null>(null);
  readonly sending = signal(false);
  readonly settingsOpen = signal(false);
  readonly ready = signal(false);
  readonly isMuted = this.audio.isMuted;

  private aesKeyPromise: Promise<CryptoKey> | null = null;
  private acknowledgedReadIds = new Set<number>();

  readonly conversation = computed<Conversation | null>(
    () => {
      const conv = conversations().find((c) => c.id === this.conversationId()) ?? null;
      if (conv) {
        console.log('[Computed] conversation updated:', conv.id, 'turn:', conv.currentTurnUserId);
      }
      return conv;
    },
  );

  readonly contact = computed<User | null>(() => {
    const conv = this.conversation();
    const me = currentUser()?.id;
    if (!conv || me == null) {
      return null;
    }
    return conv.initiator.id === me ? conv.responder : conv.initiator;
  });

  readonly isSelfConversation = computed<boolean>(() => {
    const conv = this.conversation();
    return conv ? conv.initiator.id === conv.responder.id : false;
  });

  // Tracks when a self-sent message has been echoed back and should be shown as incoming.
  private readonly forcedIncoming = signal(false);

  readonly isMyTurn = computed(() => {
    const turn = this.conversation()?.currentTurnUserId === currentUser()?.id;
    console.log('[Computed] isMyTurn updated:', turn);
    return turn;
  });

  readonly mode = computed<StageMode>(() => {
    console.log('[Mode Computed] calculating mode, ready:', this.ready(), 'displayMessage:', !!this.displayMessage(), 'isMyTurn:', this.isMyTurn());
    if (!this.ready()) {
      return 'loading';
    }
    const msg = this.displayMessage();
    const me = currentUser()?.id;
    if (msg) {
      const isOwn = msg.senderId === me && !this.forcedIncoming();
      return isOwn ? 'outgoing' : 'incoming';
    }
    return this.isMyTurn() ? 'compose' : 'awaiting';
  });

  readonly statusText = computed<string>(() => {
    switch (this.mode()) {
      case 'loading':
        return 'ESTABLISHING SECURE LINK...';
      case 'incoming':
        return 'INCOMING TRANSMISSION · DECRYPT WHEN READY';
      case 'outgoing':
        return 'TRANSMISSION SENT · AWAITING DECRYPTION';
      case 'compose':
        return 'YOUR TURN · COMPOSE TRANSMISSION';
      default:
        return 'AWAITING TRANSMISSION';
    }
  });

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.conversationId.set(id);
    activeConversationId.set(id);

    this.wireEvents();

    await this.signalr.startConnection();
    await this.signalr.joinConversation(id);

    let conv = this.conversation();
    if (!conv) {
      try {
        conv = await firstValueFrom(this.api.getConversation(id));
        upsertConversation(conv);
      } catch {
        void this.router.navigate(['/channels']);
        return;
      }
    }

    await this.hydratePending(conv);
    this.ready.set(true);

    if (!this.isMuted()) {
      this.audio.startAmbient();
    }
  }

  ngOnDestroy(): void {
    void this.signalr.leaveConversation(this.conversationId());
    this.audio.stopAmbient();
    if (activeConversationId() === this.conversationId()) {
      activeConversationId.set(null);
    }
  }

  /* ---- Event wiring ----------------------------------------------------- */

  private wireEvents(): void {
    this.signalr.onReceiveMessage$
      .pipe(
        filter((m) => m.conversationId === this.conversationId()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((m) => void this.onIncoming(m));

    this.signalr.onConversationUpdated$
      .pipe(
        filter((c) => c.id === this.conversationId()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((c) => {
        upsertConversation(c);
        void this.reconcile(c);
      });

    this.signalr.onMessageRead$
      .pipe(
        filter((e) => e.conversationId === this.conversationId()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.onMyMessageRead());
  }

  private async onIncoming(message: Message): Promise<void> {
    const decrypted = await this.decrypt(message);
    this.forcedIncoming.set(true);
    this.displayMessage.set(decrypted);
    this.audio.playIncoming();
    this.ambient?.ripple();
    const contact = this.contact();
    if (contact && !this.isSelfConversation()) {
      this.notifications.notifyNewMessage(contact.gitHubLogin, this.conversationId());
    }
    void this.signalr.acknowledgeDelivery(message.id, this.conversationId());
  }

  private async reconcile(conv: Conversation): Promise<void> {
    const pending = conv.pendingMessage;
    const me = currentUser()?.id;
    // Skip if no message, already read, or it's your own outgoing in a normal conversation.
    if (!pending || pending.status === MessageStatus.Read) {
      return;
    }
    if (pending.senderId === me && !this.isSelfConversation()) {
      return;
    }
    const current = this.displayMessage();
    if (!current || current.id !== pending.id) {
      this.forcedIncoming.set(true);
      this.displayMessage.set(await this.decrypt(pending));
    }
  }

  private onMyMessageRead(): void {
    // The contact decrypted our message; the channel now awaits their reply.
    if (this.displayMessage()?.senderId === currentUser()?.id) {
      this.displayMessage.set(null);
    }
    this.ambient?.ripple();
  }

  private async hydratePending(conv: Conversation): Promise<void> {
    const pending = conv.pendingMessage;
    if (!pending) {
      return;
    }
    if (pending.status === MessageStatus.Read) {
      return;
    }
    this.displayMessage.set(await this.decrypt(pending));
  }

  /* ---- Bubble callbacks ------------------------------------------------- */

  onRevealed(message: Message): void {
    // Always acknowledge in self-conversations (you're both parties).
    // In normal conversations, only acknowledge incoming (not your own outgoing).
    if (message.senderId === currentUser()?.id && !this.isSelfConversation()) {
      return;
    }
    if (this.acknowledgedReadIds.has(message.id)) {
      return;
    }
    this.acknowledgedReadIds.add(message.id);
    void this.signalr.acknowledgeRead(message.id, this.conversationId());
  }

  onScrambledAway(message: Message): void {
    // Clear stage when an incoming message finishes its read/scramble cycle.
    // In self-conversations every message is both sent and received by you.
    if (message.senderId !== currentUser()?.id || this.isSelfConversation()) {
      this.forcedIncoming.set(false);
      this.displayMessage.set(null);
    }
  }

  /* ---- Compose ---------------------------------------------------------- */

  async onTransmit(payload: ComposePayload): Promise<void> {
    this.sending.set(true);
    try {
      const key = await this.ensureKey();
      const { ciphertextBase64, ivBase64 } = await this.crypto.encrypt(key, payload.text);

      try {
        await this.signalr.sendMessage({
          conversationId: this.conversationId(),
          ciphertextBase64,
          ivBase64,
          revealDurationMs: payload.revealDurationMs,
          readDurationMs: payload.readDurationMs,
          scrambleDurationMs: payload.scrambleDurationMs,
          sensitivity: payload.sensitivity,
        });
      } catch (err) {
        console.error('Failed to send message via SignalR:', err);
        throw err;
      }

      const me = currentUser();
      const local: Message = {
        id: Date.now(),
        conversationId: this.conversationId(),
        senderId: me?.id ?? 0,
        senderLogin: me?.gitHubLogin ?? 'YOU',
        ciphertextBase64,
        ivBase64,
        status: MessageStatus.Pending,
        sentAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        revealDurationMs: payload.revealDurationMs,
        readDurationMs: payload.readDurationMs,
        scrambleDurationMs: payload.scrambleDurationMs,
        sensitivity: payload.sensitivity,
        plaintext: payload.text,
      };
      this.displayMessage.set(local);
      this.audio.playReveal();

      this.ensureConversationSync();
    } catch (err) {
      console.error('Error during message transmission:', err);
    } finally {
      this.sending.set(false);
    }
  }

  private ensureConversationSync(): void {
    const timeout = setTimeout(async () => {
      console.log('[Fallback] Real-time update timeout, fetching conversation...');
      try {
        const conv = await firstValueFrom(this.api.getConversation(this.conversationId()));
        upsertConversation(conv);
        console.log('[Fallback] Conversation refreshed:', conv);
      } catch (err) {
        console.error('[Fallback] Failed to refresh conversation:', err);
      }
    }, 2000);

    this.destroyRef.onDestroy(() => clearTimeout(timeout));
  }

  /* ---- Header actions --------------------------------------------------- */

  back(): void {
    void this.router.navigate(['/channels']);
  }

  toggleSettings(): void {
    this.settingsOpen.update((v) => !v);
  }

  toggleMute(): void {
    this.audio.toggleMute();
    if (!this.audio.isMuted()) {
      this.audio.startAmbient();
    }
  }

  openManual(): void {
    void this.router.navigate(['/manual']);
  }

  openPlayground(): void {
    void this.router.navigate(['/playground']);
  }

  /* ---- Crypto helpers --------------------------------------------------- */

  private ensureKey(): Promise<CryptoKey> {
    if (!this.aesKeyPromise) {
      this.aesKeyPromise = this.deriveKey();
    }
    return this.aesKeyPromise;
  }

  private async deriveKey(): Promise<CryptoKey> {
    const me = currentUser();
    const contact = this.contact();
    if (!me || !contact) {
      throw new Error('Missing identity for key derivation.');
    }
    const keys = await firstValueFrom(this.api.getUserKeys(contact.gitHubLogin));
    if (!keys.length) {
      throw new Error('Contact has no registered keys.');
    }
    const latest = [...keys].sort(
      (a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(),
    )[0];
    return this.crypto.getSharedSecretForConversation(this.conversationId(), me.id, latest.publicKeyJwk);
  }

  private async decrypt(message: Message): Promise<Message> {
    try {
      const key = await this.ensureKey();
      const plaintext = await this.crypto.decrypt(key, message.ciphertextBase64, message.ivBase64);
      return { ...message, plaintext };
    } catch {
      return { ...message, plaintext: '⚠ DECRYPTION FAILED — KEY MISMATCH' };
    }
  }
}
