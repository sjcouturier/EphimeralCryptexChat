using System.Security.Claims;
using EphemeralCryptexChat.Api.DTOs;
using EphemeralCryptexChat.Api.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace EphemeralCryptexChat.Api.Hubs;

[Authorize]
public class ChatHub : Hub<IChatClient>
{
    private readonly IMessageService _messageService;
    private readonly IConversationService _conversationService;
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(
        IMessageService messageService,
        IConversationService conversationService,
        ILogger<ChatHub> logger)
    {
        _messageService = messageService;
        _conversationService = conversationService;
        _logger = logger;
    }

    public static string GroupName(int conversationId) => $"conv_{conversationId}";

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId();
        await Clients.Others.UserOnline(userId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = GetUserId();
        await Clients.Others.UserOffline(userId);
        await base.OnDisconnectedAsync(exception);
    }

    public Task JoinConversation(int conversationId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupName(conversationId));

    public Task LeaveConversation(int conversationId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(conversationId));

    /// <summary>Persists the encrypted message and pushes it to the other participant.</summary>
    public async Task SendMessage(SendMessageDto dto)
    {
        var senderId = GetUserId();
        var message = await _messageService.SendMessageAsync(dto, senderId);

        var group = GroupName(dto.ConversationId);
        var conversation = await _conversationService.GetConversationAsync(dto.ConversationId, senderId);

        // Self-conversations: the sender is also the recipient — echo to the full group
        // (including caller) so the message arrives as an incoming transmission.
        // Normal conversations: only push to the other participant.
        var isSelf = conversation is not null
                     && conversation.Initiator.Id == conversation.Responder.Id;

        if (isSelf)
            await Clients.Group(group).ReceiveMessage(message);
        else
            await Clients.OthersInGroup(group).ReceiveMessage(message);

        if (conversation is not null)
            await Clients.Group(group).ConversationUpdated(conversation);

        _logger.LogInformation(
            "Message {MessageId} transmitted on conversation {ConversationId}.",
            message.Id, dto.ConversationId);
    }

    /// <summary>The recipient confirms they read the message; expiry shortens and the turn flips.</summary>
    public async Task AcknowledgeRead(int messageId, int conversationId)
    {
        var recipientId = GetUserId();
        var message = await _messageService.AcknowledgeReadAsync(messageId, recipientId);
        if (message is null)
        {
            return;
        }

        // The reader's turn begins; they now owe a reply to the original sender.
        await _conversationService.UpdateTurnAsync(conversationId, recipientId);

        var group = GroupName(conversationId);

        // For self-conversations notify the full group (caller is both parties).
        var conversation = await _conversationService.GetConversationAsync(conversationId, recipientId);
        var isSelf = conversation is not null
                     && conversation.Initiator.Id == conversation.Responder.Id;

        if (isSelf)
            await Clients.Group(group).MessageRead(messageId, conversationId);
        else
            await Clients.OthersInGroup(group).MessageRead(messageId, conversationId);

        if (conversation is not null)
        {
            await Clients.Group(group).ConversationUpdated(conversation);
        }
    }

    /// <summary>The recipient confirms the message was delivered to their device.</summary>
    public async Task AcknowledgeDelivery(int messageId, int conversationId)
    {
        var recipientId = GetUserId();
        var message = await _messageService.AcknowledgeDeliveryAsync(messageId, recipientId);
        if (message is null)
        {
            return;
        }

        var group = GroupName(conversationId);
        var conversation = await _conversationService.GetConversationAsync(conversationId, recipientId);
        if (conversation is not null)
        {
            await Clients.Group(group).ConversationUpdated(conversation);
        }
    }

    private int GetUserId()
    {
        var sub = Context.User?.FindFirst("sub")?.Value
                  ?? Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (int.TryParse(sub, out var userId))
        {
            return userId;
        }

        throw new HubException("Unable to resolve authenticated user.");
    }
}
