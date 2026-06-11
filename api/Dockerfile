# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["EphemeralCryptexChat.Api.csproj", "./"]
RUN dotnet restore "EphemeralCryptexChat.Api.csproj"

COPY . .
RUN dotnet build "EphemeralCryptexChat.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "EphemeralCryptexChat.Api.csproj" -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=publish /app/publish .

EXPOSE 5058
ENV ASPNETCORE_URLS=http://+:5058
ENTRYPOINT ["dotnet", "EphemeralCryptexChat.Api.dll"]
