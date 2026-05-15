using LlmWiki.Api.Modules.Identity.Entities;
using LlmWiki.Api.Modules.Org.Entities;
using LlmWiki.Api.Modules.Wiki.Entities;
using Microsoft.EntityFrameworkCore;

namespace LlmWiki.Api.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<DepartmentMember> DepartmentMembers => Set<DepartmentMember>();
    public DbSet<DepartmentModule> DepartmentModules => Set<DepartmentModule>();
    public DbSet<IngestTask> IngestTasks => Set<IngestTask>();
    public DbSet<LlmConfig> LlmConfigs => Set<LlmConfig>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<AppUser>(e =>
        {
            e.ToTable("users");
            e.HasKey(u => u.Id);
            e.Property(u => u.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.CreatedAt).HasDefaultValueSql("now()");
            e.Property(u => u.UpdatedAt).HasDefaultValueSql("now()");
            e.Property(u => u.IsSuperAdmin).HasDefaultValue(false);
        });

        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.ToTable("refresh_tokens");
            e.HasKey(r => r.Id);
            e.Property(r => r.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasIndex(r => r.Token).IsUnique();
            e.Property(r => r.CreatedAt).HasDefaultValueSql("now()");
            // 不配置 AppUser 导航属性（跨模块，只保留 FK）
        });

        modelBuilder.Entity<Organization>(e =>
        {
            e.ToTable("organizations");
            e.HasKey(o => o.Id);
            e.Property(o => o.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasIndex(o => o.Slug).IsUnique();
            e.Property(o => o.CreatedAt).HasDefaultValueSql("now()");
            e.HasMany(o => o.Departments)
             .WithOne(d => d.Org)
             .HasForeignKey(d => d.OrgId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Department>(e =>
        {
            e.ToTable("departments");
            e.HasKey(d => d.Id);
            e.Property(d => d.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(d => d.CreatedAt).HasDefaultValueSql("now()");
            e.HasMany(d => d.Members)
             .WithOne(m => m.Department)
             .HasForeignKey(m => m.DepartmentId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(d => d.Modules)
             .WithOne(m => m.Department)
             .HasForeignKey(m => m.DepartmentId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DepartmentMember>(e =>
        {
            e.ToTable("department_members");
            e.HasKey(m => m.Id);
            e.Property(m => m.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasIndex(m => new { m.DepartmentId, m.UserId }).IsUnique(); // 一个用户在一个部门只能有一条成员记录
            e.Property(m => m.JoinedAt).HasDefaultValueSql("now()");
        });

        modelBuilder.Entity<DepartmentModule>(e =>
        {
            e.ToTable("department_modules");
            e.HasKey(m => new { m.DepartmentId, m.ModuleKey }); // 复合主键
        });

        modelBuilder.Entity<IngestTask>(e =>
        {
            e.ToTable("ingest_tasks");
            e.HasKey(t => t.Id);
            e.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(t => t.Status).HasDefaultValue("queued");
            e.Property(t => t.QueuedAt).HasDefaultValueSql("now()");
            e.HasIndex(t => new { t.DepartmentId, t.SourceFileName });
            e.HasIndex(t => t.DepartmentId);
        });

        modelBuilder.Entity<LlmConfig>(e =>
        {
            e.ToTable("llm_configs");
            e.HasKey(c => c.Id);
            e.Property(c => c.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(c => c.IsActive).HasDefaultValue(true);
            e.Property(c => c.MaxContextSize).HasDefaultValue(32000);
            e.Property(c => c.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t => t.HasCheckConstraint(
                "chk_llm_config_scope",
                "num_nonnulls(user_id, department_id) = 1"));
            e.HasIndex(c => c.UserId)
             .HasFilter("user_id IS NOT NULL AND is_active = true")
             .IsUnique();
            e.HasIndex(c => c.DepartmentId)
             .HasFilter("department_id IS NOT NULL AND is_active = true")
             .IsUnique();
        });
    }
}
