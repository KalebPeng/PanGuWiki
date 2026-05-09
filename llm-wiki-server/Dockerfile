FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY src/LlmWiki.Api/LlmWiki.Api.csproj src/LlmWiki.Api/
RUN dotnet restore src/LlmWiki.Api/LlmWiki.Api.csproj

COPY src/LlmWiki.Api/ src/LlmWiki.Api/
RUN dotnet publish src/LlmWiki.Api/LlmWiki.Api.csproj -c Release -o /app/publish --no-restore -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://0.0.0.0:5200
EXPOSE 5200

ENTRYPOINT ["dotnet", "LlmWiki.Api.dll"]
