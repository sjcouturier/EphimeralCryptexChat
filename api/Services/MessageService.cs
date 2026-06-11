using EphemeralCryptexChat.Api.Data;
using EphemeralCryptexChat.Api.DTOs;
using EphemeralCryptexChat.Api.Models;
using EphemeralCryptexChat.Api.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EphemeralCryptexChat.Api.Services;

public class MessageService : IMessageService
{
    private readonly AppDbContext _db;
    private readonly int _ttlHours;

    public MessageService(AppDbContext db, IConfiguration configuration)
    {
        _db = db;
        _ttlHours = configuration.GetValue<int?>("MessageTtlHours") ?? 24;
    }

    public async Task<MessageDto> SendMessageAsync(SendMessageDto dto, int senderId)
    {
        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.Id == dto.ConversationId)
            ?? throw new InvalidOperationException("Conversation not found.");

        if (conversation.InitiatorId != senderId && conversation.ResponderId != senderId)
        {
            throw new UnauthorizedAccessException("You are not a participant of this conversation.");
        }

        if (conversation.Status == ConversationStatus.Closed)
        {
            throw new InvalidOperationException("This channel is closed.");
        }

        if (conversation.CurrentTurnUserId is int turnUserId && turnUserId != senderId)
        {
            throw new InvalidOperationException("It is not your turn to transmit.");
        }

        var now = DateTime.UtcNow;
        var message = new Message
        {
            ConversationId = dto.ConversationId,
            SenderId = senderId,
            CiphertextBase64 = dto.CiphertextBase64,
            IvBase64 = dto.IvBase64,
            Status = MessageStatus.Pending,
            SentAt = now,
            ExpiresAt = now.AddHours(_ttlHours),
            RevealDurationMs = dto.RevealDurationMs,
            ReadDurationMs = dto.ReadDurationMs,
            ScrambleDurationMs = dto.ScrambleDurationMs,
            Sensitivity = dto.Sensitivity
        };

        _db.Messages.Add(message);

        // Hand the turn to the recipient and refresh activity.
        var recipientId = conversation.InitiatorId == senderId
            ? conversation.ResponderId
            : conversation.InitiatorId;
        conversation.CurrentTurnUserId = recipientId;
        conversation.LastActivityAt = now;

        await _db.SaveChangesAsync();

        // Attach sender for DTO mapping (login).
        message.Sender = await _db.Users.FirstAsync(u => u.Id == senderId);
        return message.ToDto();
    }

    public async Task<MessageDto?> AcknowledgeDeliveryAsync(int messageId, int recipientId)
    {
        var message = await LoadParticipantMessageAsync(messageId, recipientId);
        if (message is null)
        {
            return null;
        }

        // In a normal conversation the sender cannot confirm their own delivery.
        // In a self-conversation both roles belong to the same user, so allow it.
        var isSelf = message.Conversation.InitiatorId == message.Conversation.ResponderId;
        if (message.SenderId == recipientId && !isSelf)
        {
            return message.ToDto();
        }

        if (message.Status == MessageStatus.Pending)
        {
            message.Status = MessageStatus.Delivered;
            await _db.SaveChangesAsync();
        }

        return message.ToDto();
    }

    public async Task<MessageDto?> AcknowledgeReadAsync(int messageId, int recipientId)
    {
        var message = await LoadParticipantMessageAsync(messageId, recipientId);
        if (message is null)
        {
            return null;
        }

        // In a normal conversation the sender cannot mark their own message as read.
        // In a self-conversation both roles belong to the same user, so allow it.
        var isSelf = message.Conversation.InitiatorId == message.Conversation.ResponderId;
        if (message.SenderId == recipientId && !isSelf)
        {
            return message.ToDto();
        }

        message.Status = MessageStatus.Read;
        message.ExpiresAt = DateTime.UtcNow.AddMinutes(5);
        await _db.SaveChangesAsync();

        return message.ToDto();
    }

    public async Task<MessageDto?> GetMessageAsync(int messageId, int requestingUserId)
    {
        var message = await LoadParticipantMessageAsync(messageId, requestingUserId);
        return message?.ToDto();
    }

    /// <summary>Loads a message including sender, verifying the requesting user is a channel participant.</summary>
    private async Task<Message?> LoadParticipantMessageAsync(int messageId, int requestingUserId)
    {
        var message = await _db.Messages
            .Include(m => m.Sender)
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(m => m.Id == messageId);

        if (message is null)
        {
            return null;
        }

        var conversation = message.Conversation;
        if (conversation.InitiatorId != requestingUserId && conversation.ResponderId != requestingUserId)
        {
            throw new UnauthorizedAccessException("You are not a participant of this conversation.");
        }

        return message;
    }
}
