import { format } from "date-fns";
import { ExternalLink, Link2, Unplug } from "lucide-react";
import { ConfigurationWarning, EmptyState } from "@/components/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui";
import { getDashboardData } from "@/lib/data";
import type { SocialPlatform } from "@/lib/types/domain";

const platforms: Array<{ id: SocialPlatform; label: string; enabledKey: "tiktok_enabled" | "instagram_enabled" | "youtube_enabled" }> = [
  { id: "tiktok", label: "TikTok", enabledKey: "tiktok_enabled" },
  { id: "instagram", label: "Instagram", enabledKey: "instagram_enabled" },
  { id: "youtube", label: "YouTube", enabledKey: "youtube_enabled" }
];

export default async function AccountsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { accounts, publications, connections, configured, error } = await getDashboardData();
  const useUploadPost = process.env.PUBLISHING_PROVIDER !== "direct";
  const query = (await searchParams) ?? {};
  const oauthSuccess = typeof query.oauth_success === "string" ? query.oauth_success : null;
  const oauthError = typeof query.oauth_error === "string" ? query.oauth_error : null;
  const uploadPostConnected = typeof query.upload_post_connected === "string" ? query.upload_post_connected : null;

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={useUploadPost
          ? "Each Cocorise identity maps to one Upload-Post profile for TikTok, Instagram, and YouTube."
          : "One Cocorise identity with direct OAuth connections to TikTok, Instagram, and YouTube."}
      />
      {!configured ? <ConfigurationWarning error={error} /> : null}
      {oauthSuccess ? <Panel className="mb-5 border-mint/30 bg-mint/5 p-3 text-sm text-mint">{oauthSuccess}</Panel> : null}
      {oauthError ? <Panel className="mb-5 border-danger/30 bg-danger/5 p-3 text-sm text-danger">{oauthError}</Panel> : null}
      {uploadPostConnected ? <Panel className="mb-5 border-mint/30 bg-mint/5 p-3 text-sm text-mint">Upload-Post connection flow completed for {uploadPostConnected}. Run the profile test below to verify all three platforms.</Panel> : null}

      <Panel className="mb-5 p-4">
        <form action="/api/actions" method="post" className={`grid gap-3 ${useUploadPost ? "lg:grid-cols-[minmax(150px,1fr)_minmax(170px,1fr)_100px_140px_repeat(3,auto)_auto]" : "lg:grid-cols-[minmax(160px,1fr)_110px_150px_repeat(3,auto)_auto]"}`}>
          <input type="hidden" name="action" value="account-create" />
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="name" placeholder="Cocorise 01" required />
          {useUploadPost ? <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="upload_post_profile" placeholder="Upload-Post profile" required /> : null}
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="posts_per_day" type="number" min="2" max="3" defaultValue="3" />
          <input className="rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none" name="timezone" defaultValue="Europe/Paris" />
          {platforms.map((platform) => (
            <label key={platform.id} className="flex items-center gap-2 rounded-md border border-line bg-ink px-3 py-2 text-xs text-muted">
              <input name={platform.enabledKey} type="checkbox" defaultChecked />
              {platform.label}
            </label>
          ))}
          <button className="rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-white hover:border-mint/40" type="submit">Add</button>
        </form>
      </Panel>

      {!accounts.length ? <EmptyState title="Aucun groupe de comptes" body={useUploadPost ? "Ajoute Cocorise 01 avec un identifiant de profil Upload-Post, puis connecte les trois plateformes." : "Ajoute Cocorise 01, puis connecte chaque plateforme avec les boutons OAuth."} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const next = publications.find((publication) => publication.account_group_id === account.id);
          return (
            <Panel key={account.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{account.name}</h2>
                  <p className="mt-1 text-xs text-muted">{account.posts_per_day} posts/day · {account.timezone}</p>
                </div>
                <StatusPill status={account.active ? "active" : "paused"} />
              </div>

              <div className="mt-5 divide-y divide-line border-y border-line">
                {platforms.map((platform) => {
                  const enabled = account[platform.enabledKey];
                  const connection = connections.find(
                    (candidate) => candidate.account_group_id === account.id && candidate.platform === platform.id
                  );
                  const status = !enabled
                    ? "disabled"
                    : useUploadPost
                      ? account.upload_post_profile ? "enabled" : "profile missing"
                      : connection?.status || "not connected";
                  return (
                    <div key={platform.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{platform.label}</p>
                          <p className="mt-1 truncate text-xs text-muted">
                            {useUploadPost
                              ? account.upload_post_profile ? `Managed by ${account.upload_post_profile}` : "Upload-Post profile required"
                              : connection?.external_username || connection?.external_account_id || "No OAuth account"}
                          </p>
                        </div>
                        <StatusPill status={status} />
                      </div>
                      {enabled && !useUploadPost ? (
                        <div className="mt-3 flex gap-2">
                          {connection ? (
                            <>
                              <form action="/api/actions" method="post">
                                <input type="hidden" name="action" value="social-test" />
                                <input type="hidden" name="account_group_id" value={account.id} />
                                <input type="hidden" name="platform" value={platform.id} />
                                <button className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs text-white hover:border-mint/40" type="submit">
                                  <ExternalLink className="h-3.5 w-3.5" /> Test
                                </button>
                              </form>
                              <form action="/api/actions" method="post">
                                <input type="hidden" name="action" value="social-disconnect" />
                                <input type="hidden" name="account_group_id" value={account.id} />
                                <input type="hidden" name="platform" value={platform.id} />
                                <button className="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10" type="submit">
                                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                                </button>
                              </form>
                            </>
                          ) : (
                            <a
                              className="inline-flex items-center gap-1.5 rounded-md border border-mint/30 bg-mint/5 px-2.5 py-1.5 text-xs text-mint hover:bg-mint/10"
                              href={`/api/oauth/${platform.id}/start?account_group_id=${account.id}`}
                            >
                              <Link2 className="h-3.5 w-3.5" /> Connect
                            </a>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {useUploadPost ? (
                <div className="mt-4 space-y-3">
                  <form action="/api/actions" method="post" className="flex gap-2">
                    <input type="hidden" name="action" value="account-upload-post-profile" />
                    <input type="hidden" name="account_group_id" value={account.id} />
                    <input
                      className="min-w-0 flex-1 rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-mint/60"
                      name="upload_post_profile"
                      defaultValue={account.upload_post_profile ?? ""}
                      placeholder="Upload-Post profile"
                      required
                    />
                    <button className="rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-white hover:border-mint/40" type="submit">Save</button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {platforms.filter((platform) => account[platform.enabledKey]).map((platform) => (
                      <form action="/api/actions" method="post" key={platform.id}>
                        <input type="hidden" name="action" value="upload-post-connect" />
                        <input type="hidden" name="account_group_id" value={account.id} />
                        <input type="hidden" name="platform" value={platform.id} />
                        <button className="inline-flex items-center gap-1.5 rounded-md border border-mint/30 bg-mint/5 px-2.5 py-1.5 text-xs text-mint hover:bg-mint/10" type="submit">
                          <Link2 className="h-3.5 w-3.5" /> {platform.label}
                        </button>
                      </form>
                    ))}
                    <form action="/api/actions" method="post">
                      <input type="hidden" name="action" value="upload-post-profile-test" />
                      <input type="hidden" name="account_group_id" value={account.id} />
                      <button className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs text-white hover:border-mint/40" type="submit">
                        <ExternalLink className="h-3.5 w-3.5" /> Test profile
                      </button>
                    </form>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 text-sm text-muted">
                Next post: <span className="text-white">{next ? format(new Date(next.scheduled_at), "dd MMM, HH:mm") : "None"}</span>
              </div>
              <form action="/api/actions" method="post" className="mt-4">
                <input type="hidden" name="action" value="account-active" />
                <input type="hidden" name="id" value={account.id} />
                <input type="hidden" name="active" value={account.active ? "false" : "true"} />
                <button className="w-full rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-white hover:border-mint/40" type="submit">
                  {account.active ? "Pause account" : "Resume account"}
                </button>
              </form>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
